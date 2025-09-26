import type { Env } from './lib/env';
import { loadState, saveState } from './lib/state';
import { ensureTelegramWebhook } from './telegram';
import {
  ensureSchedulerAwake,
  getSchedulerSnapshot,
  tickScheduler,
  type SchedulerSnapshot,
} from './scheduler';
import { maybeSendDailySummary } from './summary';

const BOOT_WARMUP_LABEL = 'bootWarmupAt';

async function markBoot(env: Env): Promise<void> {
  const state = await loadState(env);
  (state as any)[BOOT_WARMUP_LABEL] = new Date().toISOString();
  await saveState(env, state);
}

export async function bootstrapWorker(env: Env, request: Request | null, ctx: ExecutionContext): Promise<void> {
  const origin = request ? new URL(request.url).origin : undefined;
  ctx.waitUntil(ensureTelegramWebhook(env, origin).catch((err) => console.warn('[worker] webhook ensure failed', err)));
  ctx.waitUntil(ensureSchedulerAwake(env).catch((err) => console.warn('[worker] scheduler awake failed', err)));
  ctx.waitUntil(markBoot(env).catch((err) => console.warn('[worker] mark boot failed', err)));
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
