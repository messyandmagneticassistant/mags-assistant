import { promises as fs } from 'node:fs';

import {
  DEFAULT_KV_DAILY_LIMIT,
  estimateKvWritesRemaining,
  fetchKvUsageSummary,
} from '../lib/cloudflare/kvAnalytics';
import { describeKvWriteState, isKvWriteAllowed } from '../shared/kvWrites';

function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) {
    return 'unknown window';
  }
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

async function appendSummary(lines: string[]): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    await fs.appendFile(summaryPath, `${lines.join('\n')}\n`, 'utf8');
  } catch (error) {
    console.warn('[kv-manual] Unable to append to GitHub summary:', error);
  }
}

async function setOutputs(records: Record<string, string>): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const serialized = Object.entries(records)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  await fs.appendFile(outputPath, `${serialized}\n`, 'utf8');
}

async function main(): Promise<void> {
  const windowSeconds = parseNumber(
    process.env.KV_MANUAL_USAGE_WINDOW ?? process.env.KV_USAGE_WINDOW_SECONDS,
    86400
  );
  const limit = Math.max(
    1,
    parseNumber(process.env.KV_MANUAL_DAILY_LIMIT ?? process.env.KV_SYNC_DAILY_LIMIT, DEFAULT_KV_DAILY_LIMIT)
  );
  const warnWrites = Math.max(0, parseNumber(process.env.KV_MANUAL_WARN_WRITES, 900));
  const abortRemaining = Math.max(0, parseNumber(process.env.KV_MANUAL_ABORT_REMAINING, 50));

  const allowed = isKvWriteAllowed(process.env);
  const gateState = describeKvWriteState(process.env);
  console.log(`[kv-manual] KV write gate is currently ${gateState}.`);
  if (!allowed) {
    console.warn('::warning::KV writes are disabled by configuration; sync will be skipped unless the gate is opened.');
  }

  const usage = await fetchKvUsageSummary({ sinceSeconds: windowSeconds });
  const remaining = estimateKvWritesRemaining(usage, limit);
  const windowLabel = formatDuration(usage.windowSeconds ?? windowSeconds);

  console.log(
    `[kv-manual] Usage window ${windowLabel}: writes=${usage.writes}, reads=${usage.reads}, deletes=${usage.deletes}, remaining≈${remaining} (limit=${limit}).`
  );

  const summaryLines = [
    `### Manual KV sync usage (${windowLabel})`,
    '',
    `- Writes: **${usage.writes}**`,
    `- Reads: ${usage.reads}`,
    `- Deletes: ${usage.deletes}`,
    `- Estimated remaining (limit ${limit}): ${remaining}`,
    `- Gate state: ${gateState}`,
  ];

  let warn = false;
  if (warnWrites > 0 && usage.writes >= warnWrites) {
    warn = true;
    console.warn(
      `::warning::Cloudflare KV writes in the last ${windowLabel} reached ${usage.writes} (warn threshold ${warnWrites}).`
    );
    summaryLines.push('', `> ⚠️ Writes in window reached ${usage.writes} (warn at ${warnWrites}).`);
  }

  if (abortRemaining > 0 && remaining <= abortRemaining) {
    summaryLines.push('', `> 🚫 Remaining writes ${remaining} at/below abort threshold ${abortRemaining}.`);
    await appendSummary(summaryLines);
    console.error(
      `::error::Remaining KV writes (${remaining}) are at/below the safety threshold (${abortRemaining}). Refusing to continue.`
    );
    process.exit(1);
    return;
  }

  await appendSummary(summaryLines);
  await setOutputs({
    writes: `${usage.writes}`,
    reads: `${usage.reads}`,
    deletes: `${usage.deletes}`,
    remaining: `${remaining}`,
    limit: `${limit}`,
    window_seconds: `${usage.windowSeconds ?? windowSeconds}`,
    warn: warn ? 'true' : 'false',
  });
}

main().catch((error) => {
  console.error('[kv-manual] Failed to collect KV usage:', error);
  process.exit(1);
});
