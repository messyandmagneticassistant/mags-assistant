import type { Env } from '../lib/env';
import { loadState, saveState } from '../lib/state';

const STORAGE_KEYS = {
  queue: 'tiktok:auto:queue',
  log: 'tiktok:auto:log',
  status: 'tiktok:auto:last',
};

const DENVER_TZ = 'America/Denver';

const SAFE_HASHTAGS = [
  'momtok',
  'healingjourney',
  'soulblueprint',
  'softlife',
  'gentleglowup',
  'intuitiveliving',
  'messyandmagnetic',
];

const OVERLAY_TEMPLATES = [
  "POV: you're healing",
  "Wait for it",
  "This one hits different",
  "Soft life loading",
  "Nervous system reset",
  "Micro-repatterning in real time",
  "If you've been asking for a sign",
];

const BOOSTER_HANDLES = [
  {
    handle: '@maggieassistant',
    comments: [
      'This hit so hard 😭',
      'Saving this immediately',
      'Cannot gatekeep this softness',
    ],
  },
  {
    handle: '@willowhazeltea',
    comments: [
      'Needed this — saving for later',
      'The cozy vibes are immaculate',
      'Tears. Brb journaling 🥹',
    ],
  },
  {
    handle: '@messy.mars4',
    comments: [
      "I didn't expect to cry today 🥹",
      'Reposting to my besties immediately',
      'Like velocity unlocked ✨',
    ],
  },
];

interface BoosterAction {
  handle: string;
  action: 'like' | 'comment' | 'save' | 'share';
  at: string;
  payload?: { comment?: string };
}

interface PerformanceCheckpoint {
  dueAt: string;
  capturedAt?: string | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  likeVelocity?: number | null;
}

interface PostLogEntry {
  id: string;
  queueId: string;
  profile: string;
  caption: string;
  overlay: string;
  hashtags: string[];
  soundId?: string | null;
  trendId?: string | null;
  status: 'scheduled' | 'posted' | 'flop' | 'reposted';
  flop: boolean;
  scheduledAt: string;
  scheduledWindow: string;
  createdAt: string;
  boosterPlan: BoosterAction[];
  performance: {
    '2h': PerformanceCheckpoint;
    '6h': PerformanceCheckpoint;
    '24h': PerformanceCheckpoint;
  };
  rationale: string[];
  reason: string;
}

type QueueItemStatus = 'pending' | 'scheduled' | 'posted' | 'flop' | 'archived';

interface QueueItem {
  id: string;
  assetUrl?: string;
  caption?: string;
  overlays?: string[];
  hashtags?: string[];
  trendId?: string;
  soundId?: string;
  priority?: number;
  createdAt?: string;
  status?: QueueItemStatus;
  scheduledFor?: string | null;
  lastScheduledAt?: string | null;
  metadata?: Record<string, unknown>;
}

interface QueueState {
  items: QueueItem[];
  failures: any[];
  review: any[];
  flaggedIds: string[];
}

interface TrendEntry {
  id?: string;
  hashtag?: string;
  soundId?: string;
  score?: number;
  decayAt?: number;
}

interface TriggerAnalysis {
  score: number;
  minute: number;
  hour: number;
  window: string;
  rationale: string[];
  scheduledAt: string;
}

interface TriggerResult {
  ok: boolean;
  error?: string;
  dryrun?: boolean;
  queueSize?: number;
  pending?: number;
  scheduled?: {
    id: string;
    scheduledAt: string;
    caption: string;
    overlay: string;
    hashtags: string[];
    soundId?: string | null;
    trendId?: string | null;
    boosterPlan: BoosterAction[];
    rationale: string[];
    window: string;
  };
  analysis?: TriggerAnalysis;
  reason?: string;
}

function resolveKv(env: Env): KVNamespace {
  const candidate = (env as any).PostQ ?? env.BRAIN;
  if (!candidate || typeof candidate.get !== 'function' || typeof candidate.put !== 'function') {
    throw new Error('KV binding missing for autopost scheduler');
  }
  return candidate as KVNamespace;
}

async function readJSON<T>(env: Env, key: string, fallback: T): Promise<T> {
  const kv = resolveKv(env);
  try {
    const raw = await kv.get(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn('[autopost] failed to read', key, err);
    return fallback;
  }
}

async function writeJSON(env: Env, key: string, value: unknown): Promise<void> {
  const kv = resolveKv(env);
  try {
    await kv.put(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[autopost] failed to write', key, err);
  }
}

function normalizeQueueItem(raw: any, index: number): QueueItem {
  if (!raw || typeof raw !== 'object') {
    return {
      id: `draft-${index}`,
      status: 'pending',
    };
  }
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === 'string' && item.id ? item.id : `draft-${index}`;
  const status =
    item.status === 'scheduled' ||
    item.status === 'posted' ||
    item.status === 'flop' ||
    item.status === 'archived'
      ? (item.status as QueueItemStatus)
      : 'pending';
  const scheduledFor = typeof item.scheduledFor === 'string' ? item.scheduledFor : null;
  const lastScheduledAt = typeof item.lastScheduledAt === 'string' ? item.lastScheduledAt : null;
  const caption = typeof item.caption === 'string' ? item.caption : undefined;
  const overlays = Array.isArray(item.overlays)
    ? item.overlays.filter((val) => typeof val === 'string')
    : undefined;
  const hashtags = Array.isArray(item.hashtags)
    ? item.hashtags.filter((val) => typeof val === 'string')
    : undefined;
  const priority = typeof item.priority === 'number' && Number.isFinite(item.priority) ? item.priority : undefined;
  const createdAt = typeof item.createdAt === 'string' ? item.createdAt : undefined;
  const soundId = typeof item.soundId === 'string' ? item.soundId : undefined;
  const trendId = typeof item.trendId === 'string' ? item.trendId : undefined;

  return {
    id,
    assetUrl: typeof item.assetUrl === 'string' ? item.assetUrl : undefined,
    caption,
    overlays,
    hashtags,
    priority,
    createdAt,
    trendId,
    soundId,
    status,
    scheduledFor,
    lastScheduledAt,
    metadata: typeof item.metadata === 'object' && item.metadata ? (item.metadata as Record<string, unknown>) : undefined,
  };
}

function normalizeQueueState(raw: any): QueueState {
  if (!raw || typeof raw !== 'object') {
    return { items: [], failures: [], review: [], flaggedIds: [] };
  }
  const state = raw as Record<string, unknown>;
  const items = Array.isArray(state.items) ? state.items.map(normalizeQueueItem) : [];
  const failures = Array.isArray(state.failures) ? state.failures : [];
  const review = Array.isArray(state.review) ? state.review : [];
  const flaggedIds = Array.isArray(state.flaggedIds)
    ? state.flaggedIds.filter((value) => typeof value === 'string')
    : [];
  return { items, failures, review, flaggedIds };
}

async function loadQueue(env: Env): Promise<QueueState> {
  const state = await readJSON(env, STORAGE_KEYS.queue, {});
  return normalizeQueueState(state);
}

async function saveQueue(env: Env, state: QueueState): Promise<void> {
  await writeJSON(env, STORAGE_KEYS.queue, state);
}

async function loadLog(env: Env): Promise<PostLogEntry[]> {
  const entries = await readJSON<PostLogEntry[]>(env, STORAGE_KEYS.log, []);
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const e = entry as PostLogEntry;
      if (!e.id || !e.scheduledAt) return null;
      return e;
    })
    .filter((entry): entry is PostLogEntry => Boolean(entry));
}

async function saveLog(env: Env, log: PostLogEntry[]): Promise<void> {
  await writeJSON(env, STORAGE_KEYS.log, log);
}

async function loadTrends(env: Env): Promise<TrendEntry[]> {
  const entries = await readJSON<TrendEntry[]>(env, 'tiktok:trends:scores', []);
  if (!Array.isArray(entries)) return [];
  const now = Date.now();
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const id = typeof entry.id === 'string' || typeof entry.id === 'number' ? String(entry.id) : undefined;
      const hashtag = typeof entry.hashtag === 'string' ? entry.hashtag : undefined;
      const soundId = typeof entry.soundId === 'string' ? entry.soundId : undefined;
      const score = typeof entry.score === 'number' && Number.isFinite(entry.score) ? entry.score : 0;
      const decayAt = typeof entry.decayAt === 'number' ? entry.decayAt : undefined;
      if (decayAt && decayAt < now) return null;
      return { id, hashtag, soundId, score, decayAt } satisfies TrendEntry;
    })
    .filter((value): value is TrendEntry => Boolean(value))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function toDenver(date: Date): Date {
  return new Date(date.toLocaleString('en-US', { timeZone: DENVER_TZ }));
}

function computeBestMinute(now: Date, log: PostLogEntry[]): TriggerAnalysis {
  const rationale: string[] = [];
  const flopHourPenalty = new Map<number, number>();
  for (const entry of log) {
    if (!entry.flop) continue;
    const local = toDenver(new Date(entry.scheduledAt));
    const hour = local.getHours();
    flopHourPenalty.set(hour, (flopHourPenalty.get(hour) ?? 0) + 1);
  }

  const minutePreference = new Set([12, 17, 22, 37, 44, 52]);
  const preferredWindows: Array<{ label: string; start: number; end: number }> = [
    { label: 'Late Morning Momentum', start: 10, end: 14 },
    { label: 'Evening Prime Wave', start: 18, end: 22 },
  ];

  let best: { score: number; date: Date; hour: number; minute: number; window: string } | null = null;

  const maxIterations = 24 * 12;
  for (let step = 3; step <= maxIterations; step += 1) {
    const candidate = new Date(now.getTime() + step * 5 * 60 * 1000);
    candidate.setSeconds(0, 0);
    const local = toDenver(candidate);
    const hour = local.getHours();
    const minute = local.getMinutes();
    const window = preferredWindows.find((w) => hour >= w.start && hour < w.end);

    let score = window ? 60 : 20;
    if (window) {
      rationale.push(`Window check → ${window.label} is available`);
    }

    if (minutePreference.has(minute)) {
      score += 8;
    } else if (minute % 5 === 0) {
      score += 3;
    } else {
      score -= 5;
    }

    const penalty = flopHourPenalty.get(hour) ?? 0;
    if (penalty) {
      score -= penalty * 12;
    }

    const minutesOut = Math.round((candidate.getTime() - now.getTime()) / 60000);
    if (minutesOut < 20) {
      score -= 10;
    } else if (minutesOut >= 35 && minutesOut <= 120) {
      score += 6;
    }

    if (log.length) {
      const last = new Date(log[0].scheduledAt);
      const diff = Math.abs(candidate.getTime() - last.getTime());
      if (diff < 75 * 60 * 1000) {
        score -= 6;
      }
    }

    if (!best || score > best.score) {
      best = {
        score,
        date: candidate,
        hour,
        minute,
        window: window ? window.label : 'Calibration Window',
      };
    }
  }

  if (!best) {
    const fallback = new Date(now.getTime() + 45 * 60 * 1000);
    fallback.setSeconds(0, 0);
    return {
      score: 10,
      minute: fallback.getMinutes(),
      hour: toDenver(fallback).getHours(),
      window: 'Calibration Window',
      rationale: ['Fallback scheduling because no optimal window detected'],
      scheduledAt: fallback.toISOString(),
    };
  }

  const scheduledAt = best.date.toISOString();
  rationale.push(`Score ${best.score.toFixed(1)} selected at ${best.hour}:${best.minute.toString().padStart(2, '0')} MT`);

  return {
    score: best.score,
    minute: best.minute,
    hour: best.hour,
    window: best.window,
    rationale,
    scheduledAt,
  };
}

function selectOverlay(item: QueueItem, used: Set<string>): string {
  const candidates = Array.isArray(item.overlays) && item.overlays.length ? item.overlays : OVERLAY_TEMPLATES;
  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized) continue;
    if (used.has(normalized.toLowerCase())) continue;
    used.add(normalized.toLowerCase());
    return normalized;
  }
  const fallback = OVERLAY_TEMPLATES[0];
  used.add(fallback.toLowerCase());
  return fallback;
}

function buildHashtags(item: QueueItem, trend?: TrendEntry | null): string[] {
  const tags = new Set<string>();
  for (const tag of SAFE_HASHTAGS) tags.add(`#${tag}`);
  if (Array.isArray(item.hashtags)) {
    for (const tag of item.hashtags) {
      if (typeof tag !== 'string') continue;
      const normalized = tag.startsWith('#') ? tag : `#${tag}`;
      tags.add(normalized.toLowerCase());
    }
  }
  if (trend?.hashtag) {
    const normalized = trend.hashtag.startsWith('#') ? trend.hashtag : `#${trend.hashtag}`;
    tags.add(normalized.toLowerCase());
  }
  return Array.from(tags).slice(0, 8);
}

function buildCaption(item: QueueItem, overlay: string, trend: TrendEntry | null): string {
  const base = item.caption?.trim() || 'Magnetic mom energy + nervous system repair in real time.';
  const hook = overlay.endsWith('.') ? overlay : `${overlay} ✨`;
  const hashtags = buildHashtags(item, trend);
  return `${hook}\n${base}\n\n${hashtags.join(' ')}`;
}

function planBoosterActions(scheduledAt: string): BoosterAction[] {
  const base = new Date(scheduledAt).getTime();
  const actions: BoosterAction[] = [];
  BOOSTER_HANDLES.forEach((entry, idx) => {
    const likeAt = new Date(base + (idx + 1) * 2 * 60 * 1000);
    actions.push({ handle: entry.handle, action: 'like', at: likeAt.toISOString() });

    const commentAt = new Date(base + (idx + 1) * 4 * 60 * 1000);
    const comments = entry.comments;
    const comment = comments[idx % comments.length] || comments[0];
    actions.push({
      handle: entry.handle,
      action: 'comment',
      at: commentAt.toISOString(),
      payload: { comment },
    });

    const saveAt = new Date(base + (idx + 1) * 6 * 60 * 1000);
    actions.push({ handle: entry.handle, action: 'save', at: saveAt.toISOString() });
  });
  return actions;
}

function buildPerformance(scheduledAt: string): PostLogEntry['performance'] {
  const base = new Date(scheduledAt).getTime();
  const checkpoint = (hours: number): PerformanceCheckpoint => ({
    dueAt: new Date(base + hours * 60 * 60 * 1000).toISOString(),
    capturedAt: null,
    views: null,
    likes: null,
    comments: null,
    likeVelocity: null,
  });
  return {
    '2h': checkpoint(2),
    '6h': checkpoint(6),
    '24h': checkpoint(24),
  };
}

function pickQueueItem(queue: QueueState): QueueItem | null {
  const pending = queue.items
    .filter((item) => item.status !== 'scheduled' && item.status !== 'posted' && item.status !== 'archived')
    .sort((a, b) => {
      const priorityA = a.priority ?? 0;
      const priorityB = b.priority ?? 0;
      if (priorityA !== priorityB) return priorityB - priorityA;
      const createdA = a.createdAt ? Date.parse(a.createdAt) : 0;
      const createdB = b.createdAt ? Date.parse(b.createdAt) : 0;
      return createdA - createdB;
    });
  return pending[0] || null;
}

export async function getAutopostStatus(env: Env): Promise<{ next?: QueueItem | null; last?: PostLogEntry | null; queueSize: number; pending: number; logSample: PostLogEntry[] }> {
  const [queue, log] = await Promise.all([loadQueue(env), loadLog(env)]);
  const next = pickQueueItem(queue);
  const pending = queue.items.filter(
    (item) => item.status !== 'scheduled' && item.status !== 'posted' && item.status !== 'archived',
  ).length;
  return {
    next,
    last: log[0] || null,
    queueSize: queue.items.length,
    pending,
    logSample: log.slice(0, 5),
  };
}

export async function getRecentAutopostLog(env: Env, hours = 24): Promise<PostLogEntry[]> {
  const log = await loadLog(env);
  if (!hours || hours <= 0) return log;
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return log.filter((entry) => Date.parse(entry.scheduledAt) >= cutoff);
}

async function persistStateSnapshot(env: Env, scheduled: QueueItem, logEntry: PostLogEntry): Promise<void> {
  const state = await loadState(env);
  const scheduledPosts = Array.isArray((state as any).scheduledPosts) ? [...((state as any).scheduledPosts as any[])] : [];
  scheduledPosts.unshift({
    id: scheduled.id,
    when: logEntry.scheduledAt,
    caption: logEntry.caption,
    soundId: logEntry.soundId,
    overlay: logEntry.overlay,
    status: 'scheduled',
  });
  (state as any).scheduledPosts = scheduledPosts.slice(0, 20);
  (state as any).lastCheck = new Date().toISOString();
  (state as any).lastScheduledPost = {
    id: scheduled.id,
    when: logEntry.scheduledAt,
    caption: logEntry.caption,
    soundId: logEntry.soundId,
    overlay: logEntry.overlay,
  };
  await saveState(env, state);
}

export async function runAutopostCycle(
  env: Env,
  options: { reason?: string; dryrun?: boolean; now?: Date } = {},
): Promise<TriggerResult> {
  const now = options.now ?? new Date();
  const reason = options.reason ?? 'manual';
  const [queue, log, trends] = await Promise.all([loadQueue(env), loadLog(env), loadTrends(env)]);
  const next = pickQueueItem(queue);
  if (!next) {
    return {
      ok: false,
      error: 'queue-empty',
      dryrun: !!options.dryrun,
      reason,
      queueSize: queue.items.length,
      pending: 0,
    };
  }

  const analysis = computeBestMinute(now, log);
  const trend = trends[0] ?? null;
  const overlay = selectOverlay(next, new Set<string>());
  const caption = buildCaption(next, overlay, trend);
  const hashtags = buildHashtags(next, trend);
  const boosterPlan = planBoosterActions(analysis.scheduledAt);

  const scheduled: QueueItem = {
    ...next,
    status: 'scheduled',
    scheduledFor: analysis.scheduledAt,
    lastScheduledAt: new Date().toISOString(),
    caption,
    hashtags,
    overlays: [overlay],
    soundId: next.soundId || trend?.soundId,
    trendId: next.trendId || trend?.id,
  };

  const logEntry: PostLogEntry = {
    id: `${next.id}:${analysis.scheduledAt}`,
    queueId: next.id,
    profile: '@messyandmagnetic',
    caption,
    overlay,
    hashtags,
    soundId: scheduled.soundId || null,
    trendId: scheduled.trendId || null,
    status: 'scheduled',
    flop: false,
    scheduledAt: analysis.scheduledAt,
    scheduledWindow: analysis.window,
    createdAt: new Date().toISOString(),
    boosterPlan,
    performance: buildPerformance(analysis.scheduledAt),
    rationale: analysis.rationale,
    reason,
  };

  if (options.dryrun) {
    return {
      ok: true,
      dryrun: true,
      reason,
      scheduled: {
        id: scheduled.id,
        scheduledAt: analysis.scheduledAt,
        caption,
        overlay,
        hashtags,
        soundId: scheduled.soundId || null,
        trendId: scheduled.trendId || null,
        boosterPlan,
        rationale: analysis.rationale,
        window: analysis.window,
      },
      analysis,
      queueSize: queue.items.length,
      pending: queue.items.length,
    };
  }

  const updatedQueue: QueueState = {
    ...queue,
    items: queue.items.map((item) => (item.id === next.id ? scheduled : item)),
  };

  const updatedLog = [logEntry, ...log].slice(0, 200);

  await Promise.all([
    saveQueue(env, updatedQueue),
    saveLog(env, updatedLog),
    writeJSON(env, STORAGE_KEYS.status, {
      ...logEntry,
      queueSize: updatedQueue.items.length,
      pending: updatedQueue.items.filter(
        (item) => item.status !== 'scheduled' && item.status !== 'posted' && item.status !== 'archived',
      ).length,
    }),
    persistStateSnapshot(env, scheduled, logEntry),
  ]);

  return {
    ok: true,
    dryrun: false,
    reason,
    scheduled: {
      id: scheduled.id,
      scheduledAt: analysis.scheduledAt,
      caption,
      overlay,
      hashtags,
      soundId: scheduled.soundId || null,
      trendId: scheduled.trendId || null,
      boosterPlan,
      rationale: analysis.rationale,
      window: analysis.window,
    },
    analysis,
    queueSize: updatedQueue.items.length,
    pending: updatedQueue.items.filter(
      (item) => item.status !== 'scheduled' && item.status !== 'posted' && item.status !== 'archived',
    ).length,
  };
}
