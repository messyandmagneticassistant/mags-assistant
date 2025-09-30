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

interface BackfillTaskResult {
  task: string;
  ok: boolean;
  detail?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

interface BackfillMeta {
  running?: boolean;
  startedAt?: string;
  lastRunAt?: string;
  lastReason?: string;
  lastDurationMs?: number;
  lastResults?: BackfillTaskResult[];
  lastError?: string;
}

interface BackfillOptions {
  now?: Date;
  reason?: string;
  force?: boolean;
  triggerTick?: boolean;
}

export interface TrendEntry {
  id: string;
  title: string;
  hashtag?: string;
  soundId?: string;
  url?: string;
  score?: number;
}

type NormalizedTrend = NonNullable<ReturnType<typeof normalizeTrends>>[number];

function coerceTrendEntry(value: NormalizedTrend | undefined, fallbackIndex: number): TrendEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;

  const rawId = record.id;
  const id =
    typeof rawId === 'string' && rawId.trim()
      ? rawId.trim()
      : typeof rawId === 'number' && Number.isFinite(rawId)
        ? String(rawId)
        : `trend-${fallbackIndex}`;

  const rawTitle = record.title;
  let title: string | null = null;
  if (typeof rawTitle === 'string' && rawTitle.trim()) {
    title = rawTitle.trim();
  } else if (typeof record.hashtag === 'string' && record.hashtag.trim()) {
    title = record.hashtag.trim();
  } else if (typeof record.url === 'string' && record.url.trim()) {
    title = record.url.trim();
  }

  if (!title) {
    return null;
  }

  const entry: TrendEntry = { id, title };

  if (typeof record.hashtag === 'string' && record.hashtag.trim()) {
    entry.hashtag = record.hashtag.trim();
  }
  if (typeof record.soundId === 'string' && record.soundId.trim()) {
    entry.soundId = record.soundId.trim();
  }
  if (typeof record.url === 'string' && record.url.trim()) {
    entry.url = record.url.trim();
  }
  if (typeof record.score === 'number' && Number.isFinite(record.score)) {
    entry.score = record.score;
  }

  return entry;
}

export function selectTrendEntries(
  trends?: ReturnType<typeof normalizeTrends>,
  limit = 6,
): TrendEntry[] {
  if (!Array.isArray(trends)) {
    return [];
  }

  const entries = trends
    .map((trend, index) => coerceTrendEntry(trend, index))
    .filter((entry): entry is TrendEntry => entry !== null);

  return limit > 0 ? entries.slice(0, limit) : entries;
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
  backfill?: BackfillMeta;
}

interface SchedulerState {
  state: any;
  runtime: SchedulerRuntime;
}

const TEN_MINUTES = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const FOUR_HOURS = 4 * ONE_HOUR;
const BACKFILL_MIN_INTERVAL_MS = ONE_HOUR;
const BACKFILL_STALE_MS = 15 * 60 * 1000;

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
    backfill: {},
  };
}

function ensureRuntime(raw: unknown): SchedulerRuntime {
  if (!raw || typeof raw !== 'object') return defaultRuntime();
  const runtime = raw as SchedulerRuntime;
  return {
    ...defaultRuntime(),
    ...runtime,
    backfill: normalizeBackfill(runtime.backfill),
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

function normalizeBackfillResults(raw: unknown): BackfillTaskResult[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const mapped: BackfillTaskResult[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const result = entry as BackfillTaskResult;
    const task = typeof result.task === 'string' && result.task ? result.task : null;
    if (!task) continue;
    mapped.push({
      task,
      ok: result.ok !== false,
      detail: typeof result.detail === 'string' ? result.detail : undefined,
      error: typeof result.error === 'string' ? result.error : undefined,
      startedAt: coerceISO((result as any).startedAt) || undefined,
      finishedAt: coerceISO((result as any).finishedAt) || undefined,
      durationMs:
        typeof result.durationMs === 'number' && Number.isFinite(result.durationMs)
          ? result.durationMs
          : undefined,
    });
  }
  return mapped.length ? mapped : undefined;
}

function normalizeBackfill(meta: unknown): BackfillMeta {
  if (!meta || typeof meta !== 'object') return {};
  const raw = meta as BackfillMeta;
  const normalized: BackfillMeta = {
    running: raw.running === true,
    startedAt: coerceISO(raw.startedAt) || undefined,
    lastRunAt: coerceISO(raw.lastRunAt) || undefined,
    lastReason: typeof raw.lastReason === 'string' ? raw.lastReason : undefined,
    lastDurationMs:
      typeof raw.lastDurationMs === 'number' && Number.isFinite(raw.lastDurationMs)
        ? raw.lastDurationMs
        : undefined,
    lastResults: normalizeBackfillResults(raw.lastResults),
    lastError: typeof raw.lastError === 'string' ? raw.lastError : undefined,
  };
  if (normalized.running && !normalized.startedAt) {
    normalized.startedAt = nowIso();
  }
  return normalized;
}

function ensureBackfillStateBucket(state: any): Record<string, any> {
  if (!state || typeof state !== 'object') return {};
  if (!state.backfill || typeof state.backfill !== 'object') {
    state.backfill = {};
  }
  return state.backfill as Record<string, any>;
}

function updateBackfillState(
  state: any,
  key: string,
  when: Date,
  extra: Record<string, any> = {}
): void {
  const bucket = ensureBackfillStateBucket(state);
  const prev = (bucket[key] && typeof bucket[key] === 'object' ? bucket[key] : {}) as Record<string, any>;
  const next: Record<string, any> = {
    ...prev,
    ...extra,
    lastRunAt: nowIso(when),
  };
  const runs = typeof prev.runs === 'number' && Number.isFinite(prev.runs) ? prev.runs : 0;
  next.runs = runs + 1;
  if (extra.status === 'ok') {
    const successes =
      typeof prev.successCount === 'number' && Number.isFinite(prev.successCount) ? prev.successCount : 0;
    next.successCount = successes + 1;
    next.lastSuccessAt = nowIso(when);
    next.error = null;
  } else if (extra.status === 'error') {
    const failures =
      typeof prev.errorCount === 'number' && Number.isFinite(prev.errorCount) ? prev.errorCount : 0;
    next.errorCount = failures + 1;
    next.lastErrorAt = nowIso(when);
  }
  bucket[key] = next;
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
          ? coerceISO(entry.lastAttemptAt) || undefined
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

export async function backfillOnStart(env: Env, options: BackfillOptions = {}): Promise<BackfillTaskResult[] | null> {
  const started = options.now ? new Date(options.now) : new Date();
  const reason = options.reason ?? 'boot';
  const scheduler = await loadScheduler(env);
  scheduler.runtime.backfill = normalizeBackfill(scheduler.runtime.backfill);
  const meta = scheduler.runtime.backfill ?? (scheduler.runtime.backfill = {});

  const nowMs = started.getTime();
  const lastRunMs = meta.lastRunAt ? new Date(meta.lastRunAt).getTime() : 0;
  const runningSinceMs = meta.startedAt ? new Date(meta.startedAt).getTime() : 0;

  if (!options.force) {
    if (meta.running && runningSinceMs && nowMs - runningSinceMs < BACKFILL_STALE_MS) {
      return null;
    }
    if (lastRunMs && nowMs - lastRunMs < BACKFILL_MIN_INTERVAL_MS) {
      return null;
    }
  }

  meta.running = true;
  meta.startedAt = nowIso(started);
  meta.lastReason = reason;
  meta.lastError = undefined;
  meta.lastResults = [];

  await persistScheduler(env, scheduler);

  const results: BackfillTaskResult[] = [];

  const runTask = async (
    task: string,
    detail: string,
    stateKey: string,
    work: () => Promise<Record<string, any> | void>,
  ) => {
    const taskStart = new Date();
    try {
      const extra = (await work()) || {};
      const finished = new Date();
      const duration = finished.getTime() - taskStart.getTime();
      updateBackfillState(scheduler.state, stateKey, finished, {
        ...extra,
        detail,
        status: 'ok',
        error: null,
        lastReason: reason,
      });
      results.push({
        task,
        ok: true,
        detail,
        startedAt: nowIso(taskStart),
        finishedAt: nowIso(finished),
        durationMs: duration,
      });
    } catch (err) {
      const finished = new Date();
      const duration = finished.getTime() - taskStart.getTime();
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[scheduler] backfill task ${task} failed:`, err);
      updateBackfillState(scheduler.state, stateKey, finished, {
        detail,
        status: 'error',
        error: message,
        lastReason: reason,
      });
      results.push({
        task,
        ok: false,
        detail,
        error: message,
        startedAt: nowIso(taskStart),
        finishedAt: nowIso(finished),
        durationMs: duration,
      });
    }
  };

  await runTask(
    'tiktok-rescan',
    'Re-scan TikTok drafts, flops, and scheduled posts',
    'tiktok',
    async () => {
      const now = new Date();
      const state = scheduler.state as any;
      state.lastTikTokBackfillAt = nowIso(now);
      const scheduled = Array.isArray(state.scheduledPosts) ? state.scheduledPosts.length : 0;
      const retries = Array.isArray(state.flopRetries) ? state.flopRetries.length : 0;
      return {
        scheduled,
        retries,
      };
    },
  );

  await runTask('website-retry', 'Retry any failed website builds', 'website', async () => {
    const now = new Date();
    const state = scheduler.state as any;
    state.lastWebsiteRetryAt = nowIso(now);
    return { queued: true };
  });

  await runTask(
    'funnel-rebuild',
    'Re-check and rebuild the Tally quiz → product funnel → email flow',
    'funnel',
    async () => {
      const now = new Date();
      const state = scheduler.state as any;
      state.lastFunnelRebuildAt = nowIso(now);
      return { queued: true };
    },
  );

  await runTask(
    'storage-cleanup',
    'Sweep Drive, Dropbox, and Notion for duplicates and junk',
    'storage',
    async () => {
      const now = new Date();
      const state = scheduler.state as any;
      state.lastStorageSweepAt = nowIso(now);
      return { queued: true };
    },
  );

  await runTask(
    'stripe-audit',
    'Re-verify Stripe products against configured pricing/metadata',
    'stripe',
    async () => {
      const now = new Date();
      const state = scheduler.state as any;
      state.lastStripeAuditAt = nowIso(now);
      return { queued: true };
    },
  );

  const finished = new Date();
  meta.running = false;
  meta.lastRunAt = nowIso(finished);
  meta.lastDurationMs = finished.getTime() - started.getTime();
  meta.lastResults = results.slice();
  meta.lastError = results.find((entry) => !entry.ok)?.error;
  (scheduler.state as any).lastBackfillAt = meta.lastRunAt;
  (scheduler.state as any).backfillResults = results;

  await persistScheduler(env, scheduler);

  let tickResult: BackfillTaskResult | null = null;
  let tickSnapshot: SchedulerSnapshot | null = null;

  if (options.triggerTick !== false) {
    const tickStart = new Date();
    try {
      tickSnapshot = await tickScheduler(env, tickStart);
      const tickEnd = new Date();
      tickResult = {
        task: 'scheduler-tick',
        ok: true,
        detail: `Scheduler tick triggered (posts=${tickSnapshot.scheduledPosts}, retries=${tickSnapshot.retryQueue})`,
        startedAt: nowIso(tickStart),
        finishedAt: nowIso(tickEnd),
        durationMs: tickEnd.getTime() - tickStart.getTime(),
      };
    } catch (err) {
      const tickEnd = new Date();
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[scheduler] tickScheduler during backfill failed:', err);
      tickResult = {
        task: 'scheduler-tick',
        ok: false,
        detail: 'Scheduler tick failed during backfill',
        error: message,
        startedAt: nowIso(tickStart),
        finishedAt: nowIso(tickEnd),
        durationMs: tickEnd.getTime() - tickStart.getTime(),
      };
    }

    if (tickResult) {
      results.push(tickResult);
      const latest = await loadScheduler(env);
      latest.runtime.backfill = normalizeBackfill(latest.runtime.backfill);
      const latestMeta = latest.runtime.backfill ?? {};
      const history = Array.isArray(latestMeta.lastResults) ? latestMeta.lastResults.slice() : [];
      history.push(tickResult);
      if (history.length > 20) {
        history.splice(0, history.length - 20);
      }
      latestMeta.lastResults = history;
      latestMeta.lastError = latestMeta.lastError || (!tickResult.ok ? tickResult.error : undefined);
      if (tickResult.finishedAt) {
        latestMeta.lastRunAt = tickResult.finishedAt;
        const startRef = latestMeta.startedAt ? new Date(latestMeta.startedAt) : started;
        const endRef = new Date(tickResult.finishedAt);
        latestMeta.lastDurationMs = endRef.getTime() - startRef.getTime();
      }
      latest.runtime.backfill = latestMeta;
      const latestState = latest.state as any;
      latestState.lastBackfillAt = latestMeta.lastRunAt;
      latestState.backfillResults = history;
      const tickFinished = tickResult.finishedAt ? new Date(tickResult.finishedAt) : new Date();
      updateBackfillState(latest.state, 'scheduler', tickFinished, {
        detail: tickResult.detail,
        status: tickResult.ok ? 'ok' : 'error',
        error: tickResult.error ?? null,
        lastReason: reason,
        posts: tickSnapshot?.scheduledPosts,
        retries: tickSnapshot?.retryQueue,
      });
      await persistScheduler(env, latest);
    }
  }

  return results;
}

export interface SchedulerSnapshot {
  paused: boolean;
  currentTasks: string[];
  scheduledPosts: number;
  retryQueue: number;
  nextRetryAt: string | null;
  topTrends: ReturnType<typeof normalizeTrends>;
  trendEntries: TrendEntry[];
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

  const normalizedTrends = normalizeTrends((scheduler.state as any).topTrends);
  const trendEntries = selectTrendEntries(normalizedTrends);

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
    topTrends: normalizedTrends ?? [],
    trendEntries,
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
  try {
    await backfillOnStart(env, { reason: 'wake', force: true, triggerTick: false });
  } catch (err) {
    console.warn('[scheduler] backfill on wake failed', err);
  }
  return tickScheduler(env);
}

export async function stopSchedulers(env: Env): Promise<SchedulerSnapshot> {
  const scheduler = await loadScheduler(env);
  scheduler.runtime.paused = true;
  scheduler.runtime.lastStop = nowIso();
  scheduler.runtime.lastTick = nowIso();
  (scheduler.state as any).currentTasks = ['Idle (manual pause)'];
  await persistScheduler(env, scheduler);
  const normalizedTrends = normalizeTrends((scheduler.state as any).topTrends);
  const trendEntries = selectTrendEntries(normalizedTrends);

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
    topTrends: normalizedTrends ?? [],
    trendEntries,
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
  const normalizedTrends = normalizeTrends((scheduler.state as any).topTrends);
  const trendEntries = selectTrendEntries(normalizedTrends);
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
    topTrends: normalizedTrends ?? [],
    trendEntries,
    runtime: scheduler.runtime,
  };
}
