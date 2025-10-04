import type { Env } from './env';
import { loadState } from './state';
import { getRouterRegisteredPaths } from '../router/router';

export const CORE_WORKER_ROUTES = [
  '/ping',
  '/ping-debug',
  '/hello',
  '/health',
  '/ready',
  '/status',
  '/summary',
  '/daily',
  '/cron-report',
  '/kv/keys',
];

export type DailyMetrics = {
  timestamp: string;
  host: string | null;
  commit: string | null;
  routes: string[];
  uptimeSeconds: number | null;
  uptimeLabel: string | null;
  kvKeyCount: number | null;
  bootTimestamp: string | null;
};

type KvNamespaceLike = KVNamespace & {
  list: (options?: { limit?: number; cursor?: string }) => Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
};

function resolveKvNamespace(env: Env): KvNamespaceLike | undefined {
  const candidate =
    (env as any).PostQ ??
    (env as any).POSTQ ??
    env.BRAIN;

  if (candidate && typeof (candidate as any).list === 'function') {
    return candidate as KvNamespaceLike;
  }

  return undefined;
}

export function getWorkerRoutes(): string[] {
  const unique = new Set<string>(CORE_WORKER_ROUTES);
  for (const path of getRouterRegisteredPaths()) {
    unique.add(path);
  }

  return Array.from(unique);
}

export function getWorkerVersion(env: Env): string | null {
  const candidate =
    (env as any).WORKER_VERSION ||
    (env as any).BUILD_VERSION ||
    (env as any).COMMIT_SHA ||
    (env as any).GIT_SHA ||
    (env as any).VERSION ||
    null;

  return candidate ? String(candidate) : null;
}

export function getAdminSecret(env: Env): string | null {
  const candidate =
    (env as any).ADMIN_SECRET ||
    (env as any).WORKER_ADMIN_SECRET ||
    (env as any).MAGGIE_ADMIN_SECRET ||
    env.ADMIN_SECRET ||
    null;

  return candidate ? String(candidate) : null;
}

function formatDuration(seconds: number): string {
  const parts: string[] = [];
  const abs = Math.max(0, Math.floor(seconds));

  const days = Math.floor(abs / 86400);
  const hours = Math.floor((abs % 86400) / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const secs = abs % 60;

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!parts.length || secs) parts.push(`${secs}s`);

  return parts.join(' ');
}

export async function countKvKeys(env: Env): Promise<number | null> {
  const kv = resolveKvNamespace(env);
  if (!kv) return null;

  let count = 0;
  let cursor: string | undefined;

  try {
    do {
      const batch = await kv.list({ cursor, limit: 1000 });
      count += batch.keys.length;
      cursor = batch.list_complete ? undefined : batch.cursor;
    } while (cursor);
  } catch (err) {
    console.warn('[worker:kv] Failed to count keys', err);
    return null;
  }

  return count;
}

export async function listAllKvKeys(env: Env): Promise<string[]> {
  const kv = resolveKvNamespace(env);
  if (!kv) {
    throw new Error('KV binding missing (expected PostQ/POSTQ/BRAIN)');
  }

  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const batch = await kv.list({ cursor, limit: 1000 });
    for (const entry of batch.keys) {
      keys.push(entry.name);
    }
    cursor = batch.list_complete ? undefined : batch.cursor;
  } while (cursor);

  return keys;
}

export async function gatherDailyMetrics(
  env: Env,
  options?: { host?: string; state?: any }
): Promise<DailyMetrics> {
  const now = new Date();
  const timestamp = now.toISOString();
  const state = options?.state ?? (await loadState(env).catch((err) => {
    console.warn('[worker:daily] Failed to load state', err);
    return undefined;
  }));

  let bootTimestamp: string | null = null;
  let uptimeSeconds: number | null = null;
  let uptimeLabel: string | null = null;

  const bootCandidate = state && typeof state === 'object' ? (state as Record<string, unknown>).bootWarmupAt : null;
  if (typeof bootCandidate === 'string') {
    const bootDate = new Date(bootCandidate);
    if (!Number.isNaN(bootDate.getTime())) {
      bootTimestamp = bootCandidate;
      uptimeSeconds = Math.max(0, Math.floor((now.getTime() - bootDate.getTime()) / 1000));
      uptimeLabel = formatDuration(uptimeSeconds);
    }
  }

  let kvKeyCount: number | null = null;
  try {
    kvKeyCount = await countKvKeys(env);
  } catch (err) {
    console.warn('[worker:daily] Failed to compute KV key count', err);
  }

  return {
    timestamp,
    host: options?.host ?? null,
    commit: getWorkerVersion(env),
    routes: getWorkerRoutes(),
    uptimeSeconds,
    uptimeLabel,
    kvKeyCount,
    bootTimestamp,
  };
}

export function buildDailyMessage(metrics: DailyMetrics): string {
  const lines = [
    '✅ Maggie is online',
    metrics.host ? `Host: ${metrics.host}` : null,
    metrics.uptimeLabel ? `Uptime: ${metrics.uptimeLabel}` : 'Uptime: unavailable',
    `Commit: ${metrics.commit ?? 'unknown'}`,
    typeof metrics.kvKeyCount === 'number'
      ? `KV keys: ${metrics.kvKeyCount}`
      : 'KV keys: unavailable',
    `Routes: ${metrics.routes.join(', ')}`,
    `Timestamp: ${metrics.timestamp}`,
  ].filter(Boolean);

  return lines.join('\n');
}

export function buildDeploymentMessage(details: {
  host: string | null;
  commit: string | null;
  routes: string[];
  timestamp: string;
}): string {
  const lines = [
    '✅ Deployment confirmed — ping passed...',
    details.host ? `Host: ${details.host}` : null,
    `Commit: ${details.commit ?? 'unknown'}`,
    `Routes: ${details.routes.join(', ')}`,
    `Timestamp: ${details.timestamp}`,
  ].filter(Boolean);

  return lines.join('\n');
}
