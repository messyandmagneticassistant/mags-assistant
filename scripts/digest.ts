import process from 'node:process';

import type { AutonomyRunIssue, AutonomyRunLogEntry } from '../shared/maggieState';
import { sendTelegramMessage } from './lib/telegramClient';
import { formatInTimeZone, resolveSince, QUIET_TIMEZONE } from './lib/timeUtils';

interface DigestGenerateOptions {
  since?: Date;
  sinceInput?: string;
  now?: Date;
}

interface DigestResult {
  since: Date;
  until: Date;
  runs: AutonomyRunLogEntry[];
  actions: string[];
  errors: AutonomyRunIssue[];
  warnings: AutonomyRunIssue[];
  message: string;
  hasAlerts: boolean;
}

function resolveWorkerBase(env: NodeJS.ProcessEnv): string {
  const candidate =
    env.WORKER_URL ||
    env.WORKER_BASE_URL ||
    env.WORKER_ENDPOINT ||
    env.MAGS_WORKER_URL ||
    env.MAGGIE_WORKER_URL;
  if (!candidate) {
    throw new Error('WORKER_URL not configured');
  }
  return candidate.trim().replace(/\/$/, '');
}

async function fetchWorkerStatus(env: NodeJS.ProcessEnv): Promise<any> {
  const base = resolveWorkerBase(env);
  const url = `${base}/status`;
  const headers = new Headers();
  const token =
    env.WORKER_KEY || env.POST_THREAD_SECRET || env.MAGGIE_WORKER_KEY || env.CF_WORKER_KEY || env.AUTONOMY_WORKER_KEY;
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Worker status HTTP ${res.status}${text ? ` ${text}` : ''}`);
  }
  return res.json();
}

function coerceDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function sortRuns(runs: AutonomyRunLogEntry[]): AutonomyRunLogEntry[] {
  return [...runs].sort((a, b) => {
    const left = coerceDate(a.finishedAt) ?? new Date(0);
    const right = coerceDate(b.finishedAt) ?? new Date(0);
    return right.getTime() - left.getTime();
  });
}

function dedupeList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function dedupeIssues(issues: AutonomyRunIssue[]): AutonomyRunIssue[] {
  const map = new Map<string, AutonomyRunIssue>();
  for (const issue of issues) {
    const key = `${issue.key}:${issue.detail ?? ''}`;
    if (!map.has(key)) {
      map.set(key, issue);
    }
  }
  return [...map.values()];
}

function formatWindowLine(since: Date, until: Date): string {
  const start = formatInTimeZone(since, QUIET_TIMEZONE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZoneName: 'short',
  });
  const end = formatInTimeZone(until, QUIET_TIMEZONE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZoneName: 'short',
  });
  return `${start} → ${end}`;
}

function formatIssues(icon: string, title: string, issues: AutonomyRunIssue[]): string[] {
  if (!issues.length) {
    return [];
  }
  const lines = [`${icon} <b>${title}</b>`];
  for (const issue of issues) {
    const label = issue.label ?? issue.key;
    const detail = issue.detail ?? 'No detail recorded.';
    lines.push(`• ${label} — ${detail}`);
  }
  return lines;
}

function formatActions(actions: string[]): string[] {
  if (!actions.length) {
    return ['⚙️ Actions: none'];
  }
  return ['⚙️ <b>Actions</b>', ...actions.map((action) => `• ${action}`)];
}

function buildDigestMessage(
  since: Date,
  until: Date,
  runs: AutonomyRunLogEntry[],
  actions: string[],
  errors: AutonomyRunIssue[],
  warnings: AutonomyRunIssue[],
  status: any,
): string {
  const lines: string[] = [];
  const criticalRuns = runs.filter((run) => run.critical).length;
  const alertsCount = errors.length;
  const warningsCount = warnings.length;
  lines.push('🗓️ <b>Maggie Digest</b>');
  lines.push(`⏱️ <i>${formatWindowLine(since, until)}</i>`);
  let runsLine = `🔁 Runs: ${runs.length}`;
  if (criticalRuns) runsLine += ` • ${criticalRuns} critical`;
  if (alertsCount) runsLine += ` • ${alertsCount} alert${alertsCount === 1 ? '' : 's'}`;
  if (warningsCount) runsLine += ` • ${warningsCount} warning${warningsCount === 1 ? '' : 's'}`;
  lines.push(runsLine);
  lines.push(...formatActions(actions));
  lines.push(...formatIssues('⚠️', 'Alerts', errors));
  lines.push(...formatIssues('🟡', 'Warnings', warnings));

  const [latestRun] = runs;
  if (latestRun) {
    const finished = coerceDate(latestRun.finishedAt);
    if (finished) {
      const finishedLabel = formatInTimeZone(finished, QUIET_TIMEZONE, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZoneName: 'short',
      });
      const summary = latestRun.summary ?? 'No summary recorded.';
      lines.push(`🧾 Last run: ${finishedLabel} — ${summary}`);
    }
  } else if (status?.autonomy?.lastRunAt) {
    const finished = coerceDate(status.autonomy.lastRunAt);
    if (finished) {
      const finishedLabel = formatInTimeZone(finished, QUIET_TIMEZONE, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZoneName: 'short',
      });
      const summary = status.autonomy.lastSummary ?? 'No summary recorded.';
      lines.push(`🧾 Last run: ${finishedLabel} — ${summary}`);
    }
  }

  const nextRunIso = status?.nextRun ?? status?.autonomy?.lastNextRun;
  if (typeof nextRunIso === 'string') {
    const next = coerceDate(nextRunIso);
    if (next) {
      const nextLabel = formatInTimeZone(next, QUIET_TIMEZONE, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZoneName: 'short',
      });
      lines.push(`➡️ Next: ${nextLabel}`);
    }
  }

  const social = status?.socialQueue;
  if (social) {
    const scheduled = typeof social.scheduled === 'number' ? social.scheduled : 0;
    const retries = typeof social.flopsRetry === 'number' ? social.flopsRetry : 0;
    lines.push(`📅 Social queue: ${scheduled} scheduled • ${retries} retries`);
  }

  return lines.join('\n');
}

export async function generateDigest(options: DigestGenerateOptions = {}): Promise<DigestResult> {
  const now = options.now ?? new Date();
  const since = options.since ?? resolveSince(options.sinceInput ?? null, now);
  const status = await fetchWorkerStatus(process.env);
  const history: AutonomyRunLogEntry[] = Array.isArray(status?.autonomy?.history)
    ? (status.autonomy.history as AutonomyRunLogEntry[])
    : [];
  const filtered = history.filter((entry) => {
    const finished = coerceDate(entry.finishedAt);
    return finished ? finished.getTime() >= since.getTime() : false;
  });
  const runs = sortRuns(filtered);
  const actions = dedupeList(runs.flatMap((run) => run.actions ?? []));
  const errors = dedupeIssues(runs.flatMap((run) => run.errors ?? []));
  const warnings = dedupeIssues(runs.flatMap((run) => run.warnings ?? []));
  const message = buildDigestMessage(since, now, runs, actions, errors, warnings, status);
  const hasAlerts = runs.some((run) => run.critical) || errors.length > 0;
  return { since, until: now, runs, actions, errors, warnings, message, hasAlerts };
}

interface CliOptions {
  since?: string;
  dryRun?: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--since' && argv[i + 1]) {
      options.since = argv[i + 1];
      i += 1;
    } else if (arg === '--no-send' || arg === '--dry-run') {
      options.dryRun = true;
    }
  }
  return options;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await generateDigest({ sinceInput: args.since });
  console.log(result.message);
  if (!args.dryRun) {
    await sendTelegramMessage(result.message);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('[digest] Failed to generate digest:', err);
    process.exitCode = 1;
  });
}

export type { DigestResult };
