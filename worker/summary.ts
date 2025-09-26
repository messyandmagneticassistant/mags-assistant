import type { Env } from './lib/env';
import { loadState, saveState, sendTelegram, normalizeTrends } from './lib/state';
import type { SchedulerSnapshot } from './scheduler';
import { getSchedulerSnapshot } from './scheduler';
import { getOpenProjects, type OpenProjectSummary } from './progress';

interface SummaryMeta {
  lastSentAt?: string;
  lastSentDay?: string;
}

const SUMMARY_KEY = 'summaryMeta';

function isSixPmMountain(date: Date): boolean {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || '0');
  return hour === 18 && minute === 0;
}

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

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return `${clamped}%`;
}

function mapHealthState(state: unknown): string {
  if (typeof state !== 'string') return '❔';
  const normalized = state.toLowerCase();
  if (normalized === 'ok' || normalized === 'pass' || normalized === 'healthy') return '✅';
  if (normalized === 'fail' || normalized === 'error' || normalized === 'critical') return '❌';
  if (normalized === 'warn' || normalized === 'warning') return '⚠️';
  return '❔';
}

function summarizeHealth(state: any): { tally: string; stripe: string } {
  const result = { tally: '❔', stripe: '❔' };
  if (!state || typeof state !== 'object') {
    return result;
  }

  const autonomy = (state as any).autonomy;
  const sources: unknown[] = [];
  if (autonomy && typeof autonomy === 'object') {
    if (Array.isArray((autonomy as any).checks)) {
      sources.push((autonomy as any).checks);
    }
    if (Array.isArray((autonomy as any).history)) {
      for (const entry of (autonomy as any).history as any[]) {
        if (entry && typeof entry === 'object' && Array.isArray((entry as any).checks)) {
          sources.push((entry as any).checks);
        }
      }
    }
  }

  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const check of source) {
      if (!check || typeof check !== 'object') continue;
      const key = typeof (check as any).key === 'string' ? (check as any).key.toLowerCase() : '';
      if (key !== 'tally' && key !== 'stripe') continue;
      const symbol = mapHealthState((check as any).state);
      if (key === 'tally' && result.tally === '❔') {
        result.tally = symbol;
      } else if (key === 'stripe' && result.stripe === '❔') {
        result.stripe = symbol;
      }
    }
    if (result.tally !== '❔' && result.stripe !== '❔') {
      break;
    }
  }

  return result;
}

function summarizeFlopRecoveries(state: any): number {
  const autonomy = state && typeof state === 'object' ? (state as any).autonomy : undefined;
  const history = autonomy && typeof autonomy === 'object' && Array.isArray((autonomy as any).history)
    ? ((autonomy as any).history as any[])
    : [];
  for (const entry of history) {
    if (!entry || typeof entry !== 'object') continue;
    const actions = Array.isArray((entry as any).actions) ? ((entry as any).actions as any[]) : [];
    for (const action of actions) {
      if (typeof action !== 'string') continue;
      const match = action.match(/flops?\s+recovered\s*[:\-]?\s*(\d+)/i);
      if (match) {
        const value = Number(match[1]);
        if (Number.isFinite(value)) {
          return value;
        }
      }
    }
  }
  return 0;
}

function findWebsiteProgress(projects: OpenProjectSummary[]): number | null {
  for (const project of projects) {
    const name = project.name.toLowerCase();
    if (name.includes('website') || name.includes('site build') || name.includes('web build')) {
      return project.percentComplete;
    }
  }
  return null;
}

export async function maybeSendDailySummary(env: Env, now = new Date()): Promise<boolean> {
  const state = await loadState(env);
  const meta = (state as any)[SUMMARY_KEY] as SummaryMeta | undefined;
  const runtime = meta || {};
  const dayKey = getDayKey(now);
  if (runtime.lastSentDay === dayKey) {
    return false;
  }

  if (!isSixPmMountain(now)) {
    return false;
  }

  const scheduler: SchedulerSnapshot = await getSchedulerSnapshot(env);
  const projects = await getOpenProjects(env);

  const trends = summarizeTrends(scheduler.topTrends);
  const taskLines = buildTaskLines(scheduler.currentTasks);
  const backfillLine = describeBackfill((scheduler.runtime as any).backfill, now);
  const health = summarizeHealth(state);
  const recoveredFlops = summarizeFlopRecoveries(state);

  const websiteProgress = findWebsiteProgress(projects);
  const messageLines = [
    '🌆 Daily Recap',
    `🕕 6pm Mountain (${now.toISOString()})`,
    `🧠 Tally quiz: ${health.tally}`,
    `💸 Stripe: ${health.stripe}`,
    `🎵 TikTok: ${scheduler.scheduledPosts} scheduled`,
    `♻️ Flops recovered: ${recoveredFlops}`,
    `🔥 Trends: ${trends}`,
    `📬 Post queue: ${scheduler.scheduledPosts} scheduled, ${scheduler.retryQueue} retries`,
    `🌐 Website build: ${formatPercent(websiteProgress)}`,
    `📋 Open projects: ${projects.length}`,
    '',
    `🧩 Active tasks:\n${taskLines}`,
    backfillLine,
  ];

  await sendTelegram(env, messageLines.join('\n'));

  (state as any)[SUMMARY_KEY] = {
    lastSentAt: now.toISOString(),
    lastSentDay: dayKey,
  } satisfies SummaryMeta;
  await saveState(env, state);
  return true;
}
