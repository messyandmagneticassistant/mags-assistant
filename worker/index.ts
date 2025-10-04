import type { Env } from './lib/env';
import { loadState, saveState } from './lib/state';
import { ensureTelegramWebhook } from './telegram';
import {
  ensureSchedulerAwake,
  getSchedulerSnapshot,
  tickScheduler,
  backfillOnStart,
  type SchedulerSnapshot,
} from './scheduler';
import { maybeSendDailySummary } from './summary';
import { buildDeploymentMessage, getWorkerRoutes, getWorkerVersion } from './lib/reporting';
import { ensureCoreRouterRoutes } from './router';
// @ts-ignore - worker bundles runtime helper from shared source
import { getSendTelegram } from './lib/telegramBridge';

const BOOT_WARMUP_LABEL = 'bootWarmupAt';
const DEPLOY_PING_LABEL = 'lastDeployPing';

ensureCoreRouterRoutes();

async function markBoot(env: Env): Promise<void> {
  const state = await loadState(env);
  (state as any)[BOOT_WARMUP_LABEL] = new Date().toISOString();
  await saveState(env, state);
}

async function maybeSendDeployNotification(env: Env, request: Request): Promise<void> {
  const url = new URL(request.url);
  const host = url.host;
  const state = await loadState(env);
  const commit = getWorkerVersion(env) ?? 'unknown';
  const last = (state as any)[DEPLOY_PING_LABEL];

  let lastCommit: string | null = null;
  let lastOk = true;
  if (typeof last === 'string') {
    lastCommit = last;
  } else if (last && typeof last === 'object') {
    if (typeof (last as any).commit === 'string') lastCommit = String((last as any).commit);
    if (typeof (last as any).ok === 'boolean') lastOk = Boolean((last as any).ok);
  }

  if (lastCommit === commit && lastOk) return;

  const timestamp = new Date().toISOString();
  const message = buildDeploymentMessage({
    host,
    commit,
    routes: getWorkerRoutes(),
    timestamp,
  });

  const sendTelegramNotification = await getSendTelegram();
  const telegram = await sendTelegramNotification(message, { env });
  if (!telegram.ok) {
    console.warn('[worker] deployment telegram failed', telegram);
  }

  (state as any)[DEPLOY_PING_LABEL] = { commit, timestamp, ok: telegram.ok };
  await saveState(env, state);
}

export async function bootstrapWorker(env: Env, request: Request | null, ctx: ExecutionContext): Promise<void> {
  const origin = request ? new URL(request.url).origin : undefined;
  ctx.waitUntil(ensureTelegramWebhook(env, origin).catch((err) => console.warn('[worker] webhook ensure failed', err)));
  ctx.waitUntil(ensureSchedulerAwake(env).catch((err) => console.warn('[worker] scheduler awake failed', err)));
  ctx.waitUntil(
    backfillOnStart(env, { reason: 'boot' }).catch((err) => console.warn('[worker] boot backfill failed', err))
  );
  ctx.waitUntil(markBoot(env).catch((err) => console.warn('[worker] mark boot failed', err)));
  if (request) {
    ctx.waitUntil(maybeSendDeployNotification(env, request).catch((err) => console.warn('[worker] deploy ping failed', err)));
  }
}

export async function handleScheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<SchedulerSnapshot> {
  const when = new Date(event.scheduledTime);
  const snapshot = await tickScheduler(env, when);
  ctx.waitUntil(maybeSendDailySummary(env, when).catch((err) => console.warn('[worker] summary failed', err)));
  return snapshot;
}

export async function gatherStatus(env: Env): Promise<{ snapshot: SchedulerSnapshot; state: any; time: string }> {
  const state = await loadState(env);
  const snapshot = await getSchedulerSnapshot(env);
  return {
    snapshot,
    state,
    time: new Date().toISOString(),
  };
}

export async function gatherSummary(env: Env): Promise<{ snapshot: SchedulerSnapshot; state: any; time: string }> {
  const state = await loadState(env);
  const snapshot = await getSchedulerSnapshot(env);
  return {
    snapshot,
    state,
    time: new Date().toISOString(),
  };
}
