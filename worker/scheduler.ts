import type { Env } from './lib/env';
import { loadState, saveState, normalizeTrends } from './lib/state';

type MaybeDate = string | null | undefined;

interface RetryItem {
  id: string;
  attempts: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string | null;
  lastError?: string;
}

interface SchedulerRuntime {
  paused: boolean;
  lastWake?: string;
  lastStop?: string | null;
  lastTick?: string | null;
  lastTrendRefresh?: string | null;
  retryBackoffMinutes: number;
  retryQueue: RetryItem[];
  automationFlags: {
    socialLoop: boolean;
    retryLoop: boolean;
    exactMinutePosting: boolean;
    storageCleanup: boolean;
    bundleAssets: boolean;
    funnelAutomation: boolean;
  };
}

interface SchedulerState {
  state: any;
  runtime: SchedulerRuntime;
}

const TEN_MINUTES = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const FOUR_HOURS = 4 * ONE_HOUR;

function nowIso(date = new Date()): string {
  return date.toISOString();
}

function defaultRuntime(): SchedulerRuntime {
  return {
    paused: false,
    retryBackoffMinutes: 10,
    retryQueue: [],
    automationFlags: {
      socialLoop: true,
      retryLoop: true,
      exactMinutePosting: true,
      storageCleanup: true,
      bundleAssets: true,
      funnelAutomation: true,
    },
  };
}

function ensureRuntime(raw: unknown): SchedulerRuntime {
  if (!raw || typeof raw !== 'object') return defaultRuntime();
  const runtime = raw as SchedulerRuntime;
  return {
    ...defaultRuntime(),
    ...runtime,
    automationFlags: {
      ...defaultRuntime().automationFlags,
      ...(runtime.automationFlags || {}),
    },
    retryQueue: Array.isArray(runtime.retryQueue)
      ? runtime.retryQueue.map((entry) => ({
          id: String((entry as RetryItem).id || ''),
          attempts: Number((entry as RetryItem).attempts || 0),
          lastAttemptAt: (entry as RetryItem).lastAttemptAt || undefined,
          nextAttemptAt: (entry as RetryItem).nextAttemptAt || null,
          lastError: (entry as RetryItem).lastError || undefined,
        }))
      : [],
  };
}

async function loadScheduler(env: Env): Promise<SchedulerState> {
  const state = await loadState(env);
  const runtime = ensureRuntime((state as any).schedulerRuntime);
  (state as any).schedulerRuntime = runtime;
  return { state, runtime };
}

async function persistScheduler(env: Env, scheduler: SchedulerState): Promise<void> {
  (scheduler.state as any).schedulerRuntime = scheduler.runtime;
  await saveState(env, scheduler.state);
}

function coerceISO(value: MaybeDate): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function scheduledPosts(state: any): any[] {
  const posts = state?.scheduledPosts;
  if (!Array.isArray(posts)) return [];
  return posts;
}

function ensureRetryQueue(runtime: SchedulerRuntime, state: any): void {
  const flopRetries = Array.isArray(state?.flopRetries)
    ? (state.flopRetries as Array<string | RetryItem>)
    : [];
  const knownIds = new Set(runtime.retryQueue.map((item) => item.id));
  for (const entry of flopRetries) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (!id || knownIds.has(id)) continue;
    runtime.retryQueue.push({
      id,
      attempts: typeof entry === 'object' && entry && typeof entry.attempts === 'number' ? entry.attempts : 0,
      lastAttemptAt:
        typeof entry === 'object' && entry && typeof entry.lastAttemptAt === 'string'
          ? coerceISO(entry.lastAttemptAt)
          : undefined,
      nextAttemptAt:
        typeof entry === 'object' && entry && typeof entry.nextAttemptAt === 'string'
          ? coerceISO(entry.nextAttemptAt)
          : null,
      lastError:
        typeof entry === 'object' && entry && typeof entry.lastError === 'string'
          ? entry.lastError
          : undefined,
    });
  }
}

function computeNextRetryDelay(attempts: number, baseMinutes: number): number {
  const multiplier = Math.min(6, Math.max(1, attempts));
  const computed = baseMinutes * Math.pow(2, multiplier - 1);
  return Math.min(computed, 6 * 60); // cap at 6 hours
}

function updateRetryQueue(runtime: SchedulerRuntime, now: Date): RetryItem[] {
  const due: RetryItem[] = [];
  const nowMs = now.getTime();
  runtime.retryQueue = runtime.retryQueue.map((item) => {
    const nextAt = item.nextAttemptAt ? new Date(item.nextAttemptAt).getTime() : 0;
    if (!item.nextAttemptAt || Number.isNaN(nextAt) || nextAt <= nowMs) {
      due.push(item);
      item.lastAttemptAt = nowIso(now);
      const delay = computeNextRetryDelay(item.attempts + 1, runtime.retryBackoffMinutes);
      item.nextAttemptAt = new Date(nowMs + delay * 60 * 1000).toISOString();
      item.attempts += 1;
    }
    return item;
  });
  return due;
}

function ensureTasks(state: any, runtime: SchedulerRuntime): string[] {
  const posts = scheduledPosts(state);
  const retryCount = runtime.retryQueue.length;
  const tasks: string[] = [];

  if (runtime.paused) {
    tasks.push('Idle (manual pause)');
  } else {
    if (posts.length) {
      tasks.push('Scheduling posts at the exact right minute');
    }
    if (retryCount) {
      tasks.push('Retrying flops with exponential backoff');
    }
    tasks.push('Optimizing business funnel → email & shop flow');
    tasks.push('Scanning Drive/Notion/Stripe for new uploads');
    tasks.push('Cleaning Drive & Dropbox, bundling icons & schedules');
  }

  const nonIdle = tasks.filter((task) => !task.toLowerCase().startsWith('idle'));
  if (!nonIdle.length) {
    return ['Idle (waiting for new uploads / trends)'];
  }
  return tasks;
}

function alignPostsToMinute(posts: any[], now: Date): any[] {
  return posts
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') {
        const date = new Date(entry);
        if (Number.isNaN(date.getTime())) return { original: entry, scheduledFor: entry };
        const exact = new Date(date);
        exact.setSeconds(0, 0);
        if (exact.getTime() <= now.getTime()) {
          exact.setMinutes(exact.getMinutes() + 5);
        }
        return { original: entry, scheduledFor: exact.toISOString() };
      }
      const obj = entry as Record<string, any>;
      const iso = typeof obj.scheduledFor === 'string' ? obj.scheduledFor : typeof obj.when === 'string' ? obj.when : null;
      const date = iso ? new Date(iso) : null;
      if (date && !Number.isNaN(date.getTime())) {
        date.setSeconds(0, 0);
        if (date.getTime() <= now.getTime()) {
          date.setMinutes(date.getMinutes() + 5);
        }
        obj.exactMinute = date.toISOString();
      }
      return obj;
    })
    .filter(Boolean);
}

async function refreshTrends(env: Env, scheduler: SchedulerState, now: Date): Promise<void> {
  const runtime = scheduler.runtime;
  const last = runtime.lastTrendRefresh ? new Date(runtime.lastTrendRefresh) : null;
  if (last && now.getTime() - last.getTime() < FOUR_HOURS) {
    return;
  }
  const trendUrl = (env as any).TREND_FEED_URL || (env as any).TREND_SOURCE;
  let trends;
  if (trendUrl) {
    try {
      const res = await fetch(trendUrl);
      if (res.ok) {
        const data = await res.json();
        trends = normalizeTrends(data);
      }
    } catch (err) {
      console.warn('[scheduler] failed to refresh external trends:', err);
    }
  }
  if (!trends) {
    trends = normalizeTrends(scheduler.state?.topTrends);
  }
  if (trends) {
    (scheduler.state as any).topTrends = trends;
    runtime.lastTrendRefresh = nowIso(now);
  }
}

function updateAutonomyMetadata(state: any, runtime: SchedulerRuntime, now: Date, actions: string[]): void {
  const autonomy = typeof state.autonomy === 'object' && state.autonomy ? state.autonomy : {};
  const history = Array.isArray(autonomy.history) ? autonomy.history.slice(0, 49) : [];
  const entry = {
    startedAt: runtime.lastTick ?? nowIso(now),
    finishedAt: nowIso(now),
    durationMs: TEN_MINUTES,
    summary: actions[0] || 'automation loop',
    ok: true,
    nextRun: new Date(now.getTime() + TEN_MINUTES).toISOString(),
    actions,
  };
  history.unshift(entry);
  autonomy.history = history;
  autonomy.lastRunAt = nowIso(now);
  autonomy.lastNextRun = entry.nextRun;
  autonomy.lastActions = actions;
  autonomy.lastWarnings = Array.isArray(autonomy.lastWarnings) ? autonomy.lastWarnings : [];
  autonomy.lastErrors = Array.isArray(autonomy.lastErrors) ? autonomy.lastErrors : [];
  autonomy.lastDurationMs = entry.durationMs;
  state.autonomy = autonomy;
}

export interface SchedulerSnapshot {
  paused: boolean;
  currentTasks: string[];
  scheduledPosts: number;
  retryQueue: number;
  nextRetryAt: string | null;
  topTrends: ReturnType<typeof normalizeTrends>;
  runtime: SchedulerRuntime;
}

export async function tickScheduler(env: Env, now = new Date()): Promise<SchedulerSnapshot> {
  const scheduler = await loadScheduler(env);
  ensureRetryQueue(scheduler.runtime, scheduler.state);
  await refreshTrends(env, scheduler, now);
  scheduler.runtime.lastTick = nowIso(now);

  const posts = alignPostsToMinute(scheduledPosts(scheduler.state), now);
  if (posts.length) {
    (scheduler.state as any).scheduledPosts = posts;
  }

  const dueRetries = scheduler.runtime.paused ? [] : updateRetryQueue(scheduler.runtime, now);
  if (dueRetries.length) {
    scheduler.runtime.retryQueue = scheduler.runtime.retryQueue.map((item) => ({
      ...item,
      lastError: item.lastError || 'Retry scheduled',
    }));
  }

  const tasks = ensureTasks(scheduler.state, scheduler.runtime);
  (scheduler.state as any).currentTasks = tasks;
  (scheduler.state as any).lastCheck = nowIso(now);

  if (!scheduler.runtime.paused) {
    updateAutonomyMetadata(scheduler.state, scheduler.runtime, now, tasks.slice(0, 4));
  }

  await persistScheduler(env, scheduler);

  return {
    paused: scheduler.runtime.paused,
    currentTasks: tasks,
    scheduledPosts: posts.length,
    retryQueue: scheduler.runtime.retryQueue.length,
    nextRetryAt: scheduler.runtime.retryQueue.length
      ? scheduler.runtime.retryQueue
          .map((item) => item.nextAttemptAt)
          .filter(Boolean)
          .sort()[0] || null
      : null,
    topTrends: normalizeTrends((scheduler.state as any).topTrends) || [],
    runtime: scheduler.runtime,
  };
}

export async function wakeSchedulers(env: Env): Promise<SchedulerSnapshot> {
  const scheduler = await loadScheduler(env);
  scheduler.runtime.paused = false;
  scheduler.runtime.lastWake = nowIso();
  scheduler.runtime.lastStop = null;
  scheduler.runtime.retryBackoffMinutes = 10;
  (scheduler.state as any).currentTasks = ensureTasks(scheduler.state, scheduler.runtime);
  await persistScheduler(env, scheduler);
  return tickScheduler(env);
}

export async function stopSchedulers(env: Env): Promise<SchedulerSnapshot> {
  const scheduler = await loadScheduler(env);
  scheduler.runtime.paused = true;
  scheduler.runtime.lastStop = nowIso();
  scheduler.runtime.lastTick = nowIso();
  (scheduler.state as any).currentTasks = ['Idle (manual pause)'];
  await persistScheduler(env, scheduler);
  return {
    paused: true,
    currentTasks: ['Idle (manual pause)'],
    scheduledPosts: Array.isArray(scheduler.state?.scheduledPosts)
      ? scheduler.state.scheduledPosts.length
      : 0,
    retryQueue: scheduler.runtime.retryQueue.length,
    nextRetryAt: scheduler.runtime.retryQueue.length
      ? scheduler.runtime.retryQueue
          .map((item) => item.nextAttemptAt)
          .filter(Boolean)
          .sort()[0] || null
      : null,
    topTrends: normalizeTrends((scheduler.state as any).topTrends) || [],
    runtime: scheduler.runtime,
  };
}

export async function ensureSchedulerAwake(env: Env): Promise<void> {
  const scheduler = await loadScheduler(env);
  if (scheduler.runtime.paused) {
    await persistScheduler(env, scheduler);
    return;
  }
  if (!scheduler.runtime.lastTick) {
    scheduler.runtime.lastTick = nowIso();
  }
  (scheduler.state as any).currentTasks = ensureTasks(scheduler.state, scheduler.runtime);
  await persistScheduler(env, scheduler);
}

export async function getSchedulerSnapshot(env: Env): Promise<SchedulerSnapshot> {
  const scheduler = await loadScheduler(env);
  ensureRetryQueue(scheduler.runtime, scheduler.state);
  const tasks = ensureTasks(scheduler.state, scheduler.runtime);
  return {
    paused: scheduler.runtime.paused,
    currentTasks: tasks,
    scheduledPosts: Array.isArray(scheduler.state?.scheduledPosts)
      ? scheduler.state.scheduledPosts.length
      : 0,
    retryQueue: scheduler.runtime.retryQueue.length,
    nextRetryAt: scheduler.runtime.retryQueue.length
      ? scheduler.runtime.retryQueue
          .map((item) => item.nextAttemptAt)
          .filter(Boolean)
          .sort()[0] || null
      : null,
    topTrends: normalizeTrends((scheduler.state as any).topTrends) || [],
    runtime: scheduler.runtime,
  };
}
