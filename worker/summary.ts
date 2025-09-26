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

function summarizeTrends(trends: ReturnType<typeof normalizeTrends>): string {
  if (!Array.isArray(trends) || !trends.length) return 'n/a';
  return trends
    .slice(0, 3)
    .map((trend) => trend.title || trend.url || 'trend')
    .join(', ');
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

  const trends = summarizeTrends(scheduler.topTrends);
  const taskLines = buildTaskLines(scheduler.currentTasks);

  const message =
    '📊 Daily Summary\n' +
    'Live on Telegram ✅\n' +
    `🕔 5pm Albuquerque (${now.toISOString()})\n` +
    `🧩 Active tasks:\n${taskLines}\n` +
    `🌐 Website: ${(state as any).website || 'https://messyandmagnetic.com'}\n` +
    `📅 Social queue: ${socialQueue.scheduled} scheduled, ${socialQueue.flopsRetry} retries\n` +
    `🔥 Trends: ${trends}`;

  await sendTelegram(env, message);

  (state as any)[SUMMARY_KEY] = {
    lastSentAt: now.toISOString(),
    lastSentDay: dayKey,
  } satisfies SummaryMeta;
  await saveState(env, state);
  return true;
}
