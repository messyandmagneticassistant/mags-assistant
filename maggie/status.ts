import path from 'path';
import { promises as fs } from 'fs';

import type { Task } from '../lib/task.js';
import { readTasks } from '../lib/task.js';
import { getStatus } from '../lib/statusStore.ts';
import { getConfigValue } from '../lib/kv';

const LOCAL_TZ = process.env.MAGGIE_LOCAL_TZ || process.env.TZ || 'America/Los_Angeles';

interface BrainSyncLog {
  status?: string;
  attemptedAt?: string;
  key?: string;
  bytes?: number;
  source?: string;
  trigger?: string;
  error?: string;
  skipReason?: string;
}

function formatAbsolute(timestamp?: string | null): string {
  if (!timestamp) return 'unknown';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const utc = date.toISOString();
  const local = date.toLocaleString('en-US', {
    timeZone: LOCAL_TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return `${utc} (local: ${local} ${LOCAL_TZ})`;
}

async function fetchBrainKvSummary() {
  const key = 'PostQ:thread-state';
  try {
    const raw = await getConfigValue<string>(key);
    const bytes = typeof raw === 'string' ? Buffer.byteLength(raw) : 0;
    let lastSynced: string | undefined;
    try {
      const state = (await getConfigValue<any>('thread-state', {
        type: 'json',
      })) as Record<string, unknown>;
      const syncValue = state?.lastSynced;
      if (typeof syncValue === 'string') lastSynced = syncValue;
    } catch (err) {
      console.warn('[maggie-status] Unable to load thread-state metadata:', err);
    }
    return { key, bytes, lastSynced };
  } catch (err) {
    return {
      key,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function formatRelativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return 'just now';
  if (abs < hour) {
    const minutes = Math.round(diff / minute);
    const value = Math.abs(minutes);
    const unit = value === 1 ? 'minute' : 'minutes';
    return minutes >= 0 ? `${value} ${unit} ago` : `in ${value} ${unit}`;
  }
  if (abs < day) {
    const hours = Math.round(diff / hour);
    const value = Math.abs(hours);
    const unit = value === 1 ? 'hour' : 'hours';
    return hours >= 0 ? `${value} ${unit} ago` : `in ${value} ${unit}`;
  }
  const days = Math.round(diff / day);
  const value = Math.abs(days);
  const unit = value === 1 ? 'day' : 'days';
  return days >= 0 ? `${value} ${unit} ago` : `in ${value} ${unit}`;
}

function extractRecentTasks(tasks: Task[]) {
  return tasks
    .map((task) => {
      const lastRun = task?.metadata?.lastRun;
      return typeof lastRun === 'string' && lastRun.trim().length
        ? { name: task.name, lastRun }
        : null;
    })
    .filter((entry): entry is { name: string; lastRun: string } => !!entry)
    .sort((a, b) => Date.parse(b.lastRun) - Date.parse(a.lastRun))
    .slice(0, 3);
}

async function loadQueueSummary() {
  const queuePath = path.resolve('queue.json');
  try {
    const raw = await fs.readFile(queuePath, 'utf8');
    const parsed = JSON.parse(raw) as { items?: unknown[]; failures?: unknown[]; lastRunAt?: string };
    const queued = Array.isArray(parsed.items) ? parsed.items.length : 0;
    const failures = Array.isArray(parsed.failures) ? parsed.failures.length : 0;
    const lastRunAt = typeof parsed.lastRunAt === 'string' ? parsed.lastRunAt : null;
    return { queued, failures, lastRunAt };
  } catch {
    return null;
  }
}

async function loadBrainSyncLog(): Promise<BrainSyncLog | null> {
  const logPath = path.resolve('brain-status.log');
  try {
    const raw = await fs.readFile(logPath, 'utf8');
    const data = JSON.parse(raw) as BrainSyncLog;
    return data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[maggie-status] Unable to read brain-status.log:', err);
    }
    return null;
  }
}

export async function buildMaggieStatusMessage(): Promise<string> {
  const loops = [
    '📂 Raw footage watcher',
    '🗓️ Scheduler + poster loop',
    '♻️ Retry flops monitor',
  ];

  let tasks: Task[] = [];
  try {
    tasks = await readTasks();
  } catch (err) {
    console.warn('[maggie-status] Unable to read tasks.json:', err);
  }

  const totalTasks = tasks.length;
  const completed = tasks.filter((task) => typeof task?.metadata?.lastRun === 'string').length;
  const pending = Math.max(totalTasks - completed, 0);

  const recent = extractRecentTasks(tasks);
  const queue = await loadQueueSummary();
  const brainLog = await loadBrainSyncLog();
  const [kvSummary, statusSnapshot] = await Promise.all([
    fetchBrainKvSummary(),
    getStatus().catch(() => ({})),
  ]);

  const parts: string[] = [];
  parts.push(`<b>Active loops</b>\n${loops.map((loop) => `• ${loop}`).join('\n')}`);

  parts.push(
    `<b>Task queue</b>\n${
      totalTasks
        ? `${totalTasks} total • ${pending} pending • ${completed} completed`
        : 'No queued tasks on disk.'
    }`
  );

  if (recent.length) {
    const recentLines = recent
      .map((entry) => `• ${entry.name} — ${formatRelativeTime(entry.lastRun)}`)
      .join('\n');
    parts.push(`<b>Recent runs</b>\n${recentLines}`);
  } else {
    parts.push('<b>Recent runs</b>\nNo completed tasks recorded yet.');
  }

  if (queue) {
    const lines = [`${queue.queued} queued • ${queue.failures} failures`];
    if (queue.lastRunAt) {
      lines.push(`Last worker tick: ${formatRelativeTime(queue.lastRunAt)}`);
    }
    parts.push(`<b>Ops queue</b>\n${lines.join('\n')}`);
  }

  const brainStatus = (statusSnapshot as any)?.brainSync ?? {};
  const brainLines: string[] = [];
  const kvKey = kvSummary.key || brainLog?.key || 'PostQ:thread-state';
  const lastSuccessful = brainStatus.lastSuccessAt || kvSummary.lastSynced || brainLog?.attemptedAt;
  brainLines.push(`🧠 KV key: ${kvKey}`);
  brainLines.push(`✅ Last sync: ${formatAbsolute(lastSuccessful)}`);
  if (typeof kvSummary.bytes === 'number') {
    brainLines.push(`📦 Size: ${kvSummary.bytes} bytes`);
  } else if (brainLog?.bytes) {
    brainLines.push(`📦 Size: ${brainLog.bytes} bytes (last recorded)`);
  }
  if (brainStatus.status === 'pending' || brainLog?.status === 'prepared') {
    brainLines.push('ℹ️ Awaiting confirmation from fallback writer.');
  }
  const errorText = brainStatus.error || brainLog?.error;
  brainLines.push(errorText ? `⚠️ Last error: ${errorText}` : '⚠️ No recorded sync errors.');
  if (kvSummary.error) {
    brainLines.push(`Cloudflare fetch error: ${kvSummary.error}`);
  }
  parts.push(`<b>Brain health</b>\n${brainLines.join('\n')}`);

  const puppeteerStatus = (statusSnapshot as any)?.puppeteer as {
    status?: string;
    lastRunAt?: string;
    error?: string | null;
    fallbackModel?: string | null;
  } | null;
  const puppeteerLines: string[] = [];
  if (puppeteerStatus) {
    const icon = puppeteerStatus.status === 'success' ? '✅' : puppeteerStatus.status === 'fail' ? '⚠️' : 'ℹ️';
    const runTime = formatAbsolute(puppeteerStatus.lastRunAt ?? null);
    let details = `${icon} Last run: ${runTime}`;
    if (puppeteerStatus.fallbackModel) {
      details += ` • fallback: ${puppeteerStatus.fallbackModel}`;
    }
    if (puppeteerStatus.error) {
      details += ` • ${puppeteerStatus.error}`;
    }
    puppeteerLines.push(details);
  } else {
    puppeteerLines.push('No Puppeteer/browserless runs recorded yet.');
  }

  const stripeStatus = (statusSnapshot as any)?.webhooks?.stripe as {
    lastSuccessAt?: string;
    error?: string | null;
    lastFailureAt?: string;
  } | null;
  const stripeLines: string[] = [];
  if (stripeStatus) {
    stripeLines.push(`📊 Last success: ${formatAbsolute(stripeStatus.lastSuccessAt ?? null)}`);
    if (stripeStatus.lastFailureAt) {
      stripeLines.push(`Last failure: ${formatAbsolute(stripeStatus.lastFailureAt)}`);
    }
    if (stripeStatus.error) {
      stripeLines.push(`Latest error: ${stripeStatus.error}`);
    }
  } else {
    stripeLines.push('No Stripe webhook activity recorded yet.');
  }

  parts.push(`<b>Automation health</b>\n${puppeteerLines.join('\n')}\n${stripeLines.join('\n')}`);

  parts.push(`<i>Updated ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC</i>`);

  return parts.join('\n\n');
}
