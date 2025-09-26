import type { Env } from './lib/env';
import { loadState, saveState, sendTelegram, normalizeTrends } from './lib/state';
import type { SchedulerSnapshot } from './scheduler';
import { getSchedulerSnapshot } from './scheduler';

interface SummaryMeta {
  lastSentAt?: string;
  lastSentDay?: string;
}

const SUMMARY_KEY = 'summaryMeta';
const TARGET_UTC_HOUR = 23; // 5pm Albuquerque

function getDayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replace(/\//g, '-');
}

function buildTaskLines(tasks: string[]): string {
  const active = tasks.filter((task) => !task.toLowerCase().startsWith('idle'));
  if (!active.length) {
    return 'Idle (waiting for new uploads / trends)';
  }
  return active
    .slice(0, 3)
    .map((task, index) => `${index + 1}. ${task}`)
    .join('\n');
}

function formatRelativeDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes <= 0) return '<1m';
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

function describeBackfill(meta: any, now: Date): string {
  const prefix = '🧹 Backfill';
  if (meta && typeof meta === 'object') {
    if (meta.running) {
      return `${prefix}: running now`;
    }
    const lastRunAt = typeof meta.lastRunAt === 'string' ? new Date(meta.lastRunAt) : null;
    const lastError = typeof meta.lastError === 'string' ? meta.lastError : '';
    if (lastRunAt && !Number.isNaN(lastRunAt.getTime())) {
      const diff = now.getTime() - lastRunAt.getTime();
      const rel = formatRelativeDuration(diff);
      if (diff <= 24 * 60 * 60 * 1000) {
        return lastError
          ? `${prefix}: ✅ ran ${rel} ago (last warning: ${lastError.slice(0, 96)})`
          : `${prefix}: ✅ ran ${rel} ago`;
      }
      const iso = lastRunAt.toISOString();
      return lastError
        ? `${prefix}: ⚠️ overdue — last run ${iso} (error: ${lastError.slice(0, 96)})`
        : `${prefix}: ⚠️ overdue — last run ${iso}`;
    }
    if (lastError) {
      return `${prefix}: ⚠️ pending (${lastError.slice(0, 96)})`;
    }
  }
  return `${prefix}: not yet run`;
}

function summarizeTrends(trends: ReturnType<typeof normalizeTrends>): string {
  if (!Array.isArray(trends) || !trends.length) return 'n/a';
  return trends
    .slice(0, 3)
    .map((trend) => trend.title || trend.url || 'trend')
    .join(', ');
}

function summarizeHealth(entry: any): string {
  if (!entry || typeof entry !== 'object') return '⚪️ pending';
  const ok = entry.ok;
  const icon = ok === true ? '✅' : ok === false ? '❌' : '⚪️';
  const issue = Array.isArray(entry.issues) && entry.issues.length ? entry.issues[0] : null;
  const warning = Array.isArray(entry.warnings) && entry.warnings.length ? entry.warnings[0] : null;
  const detail = typeof entry.detail === 'string' && entry.detail.trim() ? entry.detail.trim() : null;
  const checkedAt = typeof entry.checkedAt === 'string' && entry.checkedAt.trim() ? entry.checkedAt.trim() : null;
  const note = issue || warning || detail || (checkedAt ? `checked ${checkedAt}` : 'pending');
  return `${icon} ${note}`;
}

export async function maybeSendDailySummary(env: Env, now = new Date()): Promise<boolean> {
  const state = await loadState(env);
  const meta = (state as any)[SUMMARY_KEY] as SummaryMeta | undefined;
  const runtime = meta || {};
  const dayKey = getDayKey(now);
  if (runtime.lastSentDay === dayKey) {
    return false;
  }

  const hour = now.getUTCHours();
  if (hour !== TARGET_UTC_HOUR) {
    return false;
  }

  const scheduler: SchedulerSnapshot = await getSchedulerSnapshot(env);
  const socialQueue = {
    scheduled: Array.isArray((state as any).scheduledPosts) ? (state as any).scheduledPosts.length : 0,
    flopsRetry: Array.isArray((state as any).flopRetries) ? (state as any).flopRetries.length : 0,
    nextPost: Array.isArray((state as any).scheduledPosts) ? (state as any).scheduledPosts[0] : null,
  };

  const health = (state as any)?.health || {};
  const metrics = (state as any)?.metrics || {};
  const websiteStatus = summarizeHealth((health as any).website);
  const tallyStatus = summarizeHealth((health as any).tally);
  const stripeStatus = summarizeHealth((health as any).stripe);
  const flopsRecovered =
    typeof metrics?.flopsRecovered === 'number' && Number.isFinite(metrics.flopsRecovered)
      ? metrics.flopsRecovered
      : 0;

  const trends = summarizeTrends(scheduler.topTrends);
  const taskLines = buildTaskLines(scheduler.currentTasks);
  const backfillLine = describeBackfill((scheduler.runtime as any).backfill, now);

  const message =
    '📊 Daily Summary\n' +
    'Live on Telegram ✅\n' +
    `🕔 5pm Albuquerque (${now.toISOString()})\n` +
    `🧩 Active tasks:\n${taskLines}\n` +
    `${backfillLine}\n` +
    `🌐 Website: ${websiteStatus}\n` +
    `🧠 Tally quiz: ${tallyStatus}\n` +
    `💸 Stripe: ${stripeStatus}\n` +
    `🎵 TikTok: ${socialQueue.scheduled} scheduled | ${socialQueue.flopsRetry} retries\n` +
    `♻️ Flops recovered: ${flopsRecovered}\n` +
    `🔥 Trends: ${trends}`;

  await sendTelegram(env, message);

  (state as any)[SUMMARY_KEY] = {
    lastSentAt: now.toISOString(),
    lastSentDay: dayKey,
  } satisfies SummaryMeta;
  await saveState(env, state);
  return true;
}
