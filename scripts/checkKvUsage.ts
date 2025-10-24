import { promises as fs } from 'node:fs';
import process from 'node:process';

import {
  DEFAULT_KV_DAILY_LIMIT,
  estimateKvWritesRemaining,
  fetchKvUsageSummary,
} from '../lib/cloudflare/kvAnalytics';
import { describeKvWriteState, isKvWriteAllowed } from '../shared/kvWrites';

const TRUTHY = new Set(['1', 'true', 'yes', 'on', 'enable']);
const FALSY = new Set(['0', 'false', 'no', 'off', 'disable']);

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return undefined;
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (TRUTHY.has(normalized)) return true;
    if (FALSY.has(normalized)) return false;
  }
  return undefined;
}

function getArgFlag(name: string): boolean {
  const normalized = name.startsWith('--') ? name : `--${name}`;
  return process.argv.includes(normalized);
}

function getArgValue(name: string): string | undefined {
  const normalized = name.startsWith('--') ? name : `--${name}`;
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === normalized) {
      return process.argv[index + 1];
    }
    if (process.argv[index].startsWith(`${normalized}=`)) {
      return process.argv[index].split('=')[1];
    }
  }
  return undefined;
}

function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

async function appendSummary(lines: string[]): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    await fs.appendFile(summaryPath, `${lines.join('\n')}\n`, 'utf8');
  } catch (error) {
    console.warn('[kv-usage] Unable to append to GitHub summary:', error);
  }
}

function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return 'unknown window';
  if (seconds >= 3600) {
    const hours = (seconds / 3600).toFixed(1);
    return `${hours}h`;
  }
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `${minutes}m`;
  }
  return `${Math.round(seconds)}s`;
}

async function main(): Promise<void> {
  const windowArg = getArgValue('window');
  const windowSeconds = parseNumber(
    windowArg ?? process.env.KV_USAGE_WINDOW_SECONDS,
    3600
  );

  const parsedLimit = parseNumber(process.env.KV_USAGE_DAILY_LIMIT, DEFAULT_KV_DAILY_LIMIT);
  const limit = parsedLimit > 0 ? parsedLimit : DEFAULT_KV_DAILY_LIMIT;

  const errorRemaining = parseNumber(process.env.KV_USAGE_ERROR_REMAINING, 100);
  const warnRemaining = Math.max(
    parseNumber(process.env.KV_USAGE_WARN_REMAINING, 150),
    errorRemaining
  );
  const expectIdleFlag =
    getArgFlag('expect-idle') || parseBoolean(process.env.KV_USAGE_EXPECT_IDLE) === true;
  const idleThreshold = parseNumber(process.env.KV_USAGE_IDLE_THRESHOLD, 0);

  const allowed = isKvWriteAllowed(process.env);
  const stateLabel = describeKvWriteState(process.env);

  console.log(`[kv-usage] KV write gate currently ${stateLabel}.`);
  if (!allowed) {
    console.log('[kv-usage] Writes disabled; expecting zero activity unless override occurs.');
  }

  const usage = await fetchKvUsageSummary({ sinceSeconds: windowSeconds });
  const remaining = estimateKvWritesRemaining(usage, limit);
  const windowLabel = formatDuration(usage.windowSeconds ?? windowSeconds);

  console.log(
    `[kv-usage] Window ${windowLabel}: writes=${usage.writes}, reads=${usage.reads}, deletes=${usage.deletes}, estimated remaining=${remaining}.`
  );

  const summaryLines = [
    `### Cloudflare KV usage (${windowLabel})`,
    '',
    `- Writes: **${usage.writes}**`,
    `- Reads: ${usage.reads}`,
    `- Deletes: ${usage.deletes}`,
    `- Estimated remaining (limit ${limit}): ${remaining}`,
    `- Gate state: ${stateLabel}`,
  ];

  let exitCode = 0;

  if (expectIdleFlag && usage.writes > idleThreshold) {
    console.error(
      `[kv-usage] Unexpected write activity detected. Observed ${usage.writes} writes in the last ${windowLabel} (threshold=${idleThreshold}).`
    );
    summaryLines.push(
      '',
      `> ⚠️ Unexpected write activity detected (${usage.writes} > threshold ${idleThreshold}).`
    );
    exitCode = Math.max(exitCode, 1);
  }

  if (remaining <= errorRemaining) {
    console.error(
      `[kv-usage] Remaining KV writes (${remaining}) below critical threshold (${errorRemaining}).`
    );
    summaryLines.push('', `> 🚨 Remaining writes below critical threshold (${remaining}).`);
    exitCode = Math.max(exitCode, 2);
  } else if (remaining <= warnRemaining) {
    console.warn(
      `[kv-usage] Remaining KV writes (${remaining}) below warning threshold (${warnRemaining}).`
    );
    summaryLines.push('', `> ⚠️ Remaining writes approaching limit (${remaining}).`);
    exitCode = Math.max(exitCode, 1);
  }

  await appendSummary(summaryLines);

  if (exitCode > 0) {
    process.exit(exitCode);
  }
}

main().catch((error) => {
  console.error('[kv-usage] Failed to collect Cloudflare KV analytics:', error);
  process.exit(1);
});

