import process from 'node:process';

import { getConfigValue } from '../lib/kv';
import {
  AUTONOMY_LAST_RUN_KEY,
  AUTONOMY_RUN_LOG_KEY,
  AutonomyRunLogEntry,
} from './fullAutonomy';
import { sendTelegramMessage } from './lib/telegramClient';

const DENVER_TZ = 'America/Denver';
const DEFAULT_WINDOW_HOURS = 24;
const MAX_ALERT_LINES = 6;

interface DigestOptions {
  since?: string | null;
  send?: boolean;
}

interface ParsedOptions extends DigestOptions {
  rawSince?: string | null;
}

interface DigestResult {
  text: string;
  since: string;
  until: string;
  runs: AutonomyRunLogEntry[];
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDenver(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    timeZone: DENVER_TZ,
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function fetchRunHistory(): Promise<AutonomyRunLogEntry[]> {
  try {
    const data = await getConfigValue<AutonomyRunLogEntry[]>(AUTONOMY_RUN_LOG_KEY, { type: 'json' });
    if (Array.isArray(data)) {
      return data.filter((entry): entry is AutonomyRunLogEntry => !!entry && typeof entry === 'object');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/Failed to fetch config/.test(message)) {
      console.warn('[digest] Unable to load run history:', err);
    }
  }

  try {
    const latest = await getConfigValue<AutonomyRunLogEntry>(AUTONOMY_LAST_RUN_KEY, { type: 'json' });
    if (latest && typeof latest === 'object') {
      return [latest];
    }
  } catch {
    // ignore — handled as empty history
  }

  return [];
}

function resolveSinceTimestamp(
  rawSince: string | null | undefined,
  history: AutonomyRunLogEntry[],
): string {
  if (rawSince && rawSince.toLowerCase() === 'lastquietstart') {
    for (const entry of history) {
      if (entry?.quiet?.windowStart) {
        return entry.quiet.windowStart;
      }
    }
  }

  if (rawSince) {
    const parsed = toDate(rawSince);
    if (parsed) return parsed.toISOString();
    console.warn(`[digest] Ignoring invalid --since value: ${rawSince}`);
  }

  const fallback = new Date(Date.now() - DEFAULT_WINDOW_HOURS * 60 * 60 * 1000);
  return fallback.toISOString();
}

function parseArgs(argv: string[]): ParsedOptions {
  const options: ParsedOptions = { send: true, rawSince: null };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--since') {
      options.rawSince = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith('--since=')) {
      options.rawSince = arg.slice('--since='.length);
      continue;
    }
    if (arg === '--no-send' || arg === '--dry-run') {
      options.send = false;
      continue;
    }
    if (arg === '--send') {
      options.send = true;
      continue;
    }
  }

  if (options.rawSince) {
    options.since = options.rawSince;
  }

  return options;
}

function clampAlerts(entries: string[]): string[] {
  if (entries.length <= MAX_ALERT_LINES) return entries;
  return [...entries.slice(0, MAX_ALERT_LINES - 1), `… ${entries.length - (MAX_ALERT_LINES - 1)} more`];
}

function summarizeAlerts(
  runs: AutonomyRunLogEntry[],
  selector: (entry: AutonomyRunLogEntry) => string[],
): string[] {
  const lines: string[] = [];
  for (const run of [...runs].reverse()) {
    const when = formatDenver(run.finishedAt ?? run.startedAt);
    for (const alert of selector(run)) {
      if (!alert) continue;
      lines.push(`${when} — ${alert}`);
    }
  }
  return clampAlerts(lines);
}

function summarizeActions(runs: AutonomyRunLogEntry[]): string[] {
  const lines: string[] = [];
  for (const run of [...runs].reverse()) {
    if (!Array.isArray(run.actions)) continue;
    const when = formatDenver(run.finishedAt ?? run.startedAt);
    for (const action of run.actions) {
      if (!action) continue;
      lines.push(`${when} — ${action}`);
    }
  }
  return clampAlerts(lines);
}

function formatNextRun(nextRun: string | null | undefined): string {
  if (!nextRun) return 'unscheduled';
  return `${formatDenver(nextRun)} (${DENVER_TZ})`;
}

export async function buildDigest(options: DigestOptions = {}): Promise<DigestResult> {
  const history = await fetchRunHistory();
  const sinceIso = resolveSinceTimestamp(options.since ?? null, history);
  const sinceDate = new Date(sinceIso);

  const filtered = history
    .filter((entry) => {
      const finished = toDate(entry.finishedAt) ?? toDate(entry.startedAt);
      if (!finished) return false;
      return finished.getTime() >= sinceDate.getTime();
    })
    .sort((a, b) => {
      const left = toDate(a.finishedAt) ?? toDate(a.startedAt);
      const right = toDate(b.finishedAt) ?? toDate(b.startedAt);
      if (!left && !right) return 0;
      if (!left) return -1;
      if (!right) return 1;
      return left.getTime() - right.getTime();
    });

  const untilIso = filtered.length
    ? (toDate(filtered[filtered.length - 1].finishedAt) ?? new Date()).toISOString()
    : new Date().toISOString();

  const totalRuns = filtered.length;
  const quietRuns = filtered.filter((entry) => entry?.quiet?.muted).length;
  const criticalRuns = filtered.filter((entry) => entry.critical).length;
  const errorRuns = filtered.filter((entry) => entry.errors?.length).length;
  const warningRuns = filtered.filter((entry) => entry.warnings?.length).length;
  const latest = filtered[filtered.length - 1] ?? history[0] ?? null;

  const alertLines = summarizeAlerts(filtered, (entry) => entry.errors ?? []);
  const warningLines = summarizeAlerts(filtered, (entry) => entry.warnings ?? []);
  const actionLines = summarizeActions(filtered);

  const queue = latest?.queue;
  const nextRun = latest?.nextRun ?? latest?.statusTimestamp ?? null;

  const parts: string[] = [];
  parts.push('📰 Maggie Digest');
  parts.push(`🕒 Window: ${formatDenver(sinceIso)} → ${formatDenver(untilIso)} (${DENVER_TZ})`);
  const metaBits: string[] = [`🔁 Runs: ${totalRuns}`];
  if (quietRuns) metaBits.push(`🔕 Quiet: ${quietRuns}`);
  if (criticalRuns) metaBits.push(`❗ Critical: ${criticalRuns}`);
  if (errorRuns) metaBits.push(`❌ Errors: ${errorRuns}`);
  if (warningRuns) metaBits.push(`⚠️ Warns: ${warningRuns}`);
  parts.push(metaBits.join(' • '));
  if (latest) {
    parts.push(`🧾 Summary: ${latest.summary?.text ?? 'No summary available'}`);
  }

  if (queue) {
    const scheduled = queue.scheduled ?? '0';
    const retries = queue.retries ?? '0';
    const nextPost = queue.nextPost ? String(queue.nextPost) : 'none';
    parts.push(`📅 Queue: ${scheduled} scheduled • 🔁 ${retries} retries • ➡️ ${nextPost}`);
  }

  parts.push(`⏭️ Next: ${formatNextRun(nextRun)}`);

  if (alertLines.length) {
    parts.push('❌ Alerts:');
    parts.push(...alertLines.map((line) => `• ${line}`));
  }

  if (warningLines.length) {
    parts.push('⚠️ Warnings:');
    parts.push(...warningLines.map((line) => `• ${line}`));
  }

  if (actionLines.length) {
    parts.push('📝 Actions:');
    parts.push(...actionLines.map((line) => `• ${line}`));
  }

  if (!alertLines.length && !warningLines.length && !actionLines.length) {
    parts.push('✅ No notable alerts or actions recorded in this window.');
  }

  return {
    text: parts.join('\n'),
    since: sinceIso,
    until: untilIso,
    runs: filtered,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildDigest({ since: options.rawSince });

  if (options.send !== false) {
    const response = await sendTelegramMessage(result.text);
    if (!response.ok) {
      console.warn('[digest] Failed to send Telegram digest:', response.error ?? response.status);
    }
  } else {
    console.log(result.text);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('[digest] Fatal error:', err);
    process.exitCode = 1;
  });
}

export default buildDigest;
