import { getConfig } from '../utils/config';
import { logBrain } from './logBrain.ts';
import { logBrainSyncToSheet, logErrorToSheet } from './maggieLogs.ts';
import { updateBrainStatus } from './statusStore.ts';

export interface BrainUpdate {
  /**
   * Primary message for the brain log. Legacy property maintained for
   * backwards compatibility.
   */
  message?: string;
  /**
   * Optional alias for `message` used by higher level helpers.
   */
  note?: string;
  /**
   * Optional tier tags for the log entry.
   */
  tiers?: string[] | string;
  /**
   * Identifies the source of the update; maps to the `context` in the log.
   */
  updatedBy?: string;

  /**
   * Optional trigger identifier for advanced workflows.
   */
  trigger?: string;

  /**
   * Arbitrary updates to merge into the remote brain config.
   */
  updates?: Record<string, any>;
}

export async function updateBrain(update: BrainUpdate, context = 'system') {
  const base = process.env.WORKER_URL;
  const key = process.env.WORKER_KEY;

  // Allow `note`/`updatedBy` aliases
  const { note, updatedBy, ...rest } = update;
  const message = rest.message ?? note;
  const ctx = updatedBy || context;
  if (!message) {
    throw new Error('updateBrain requires a `message` or `note`');
  }

  // Always log locally first
  logBrain({ message, tiers: rest.tiers }, ctx);

  const brain = await getConfig('brain');
  const next = { ...brain, ...rest, message };
  const payload = { ...rest, message, updatedBy };
  const attemptAt = new Date().toISOString();
  const kvKey = 'PostQ:thread-state';
  let status: 'success' | 'fail' | 'pending' = 'success';
  let errorMessage: string | undefined;
  const recoverySteps: string[] = [];
  const sizeBytes = Buffer.from(JSON.stringify(next)).length;
  let result: unknown;

  // Try primary worker endpoint
  try {
    if (base && key) {
      const url = `${base.replace(/\/?$/, '')}/config?scope=brain`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        throw new Error(`Failed to update brain: ${res.status}`);
      }
      result = await res.json();
      status = 'success';
      return result;
    }

    throw new Error('Missing WORKER_URL or WORKER_KEY');
  } catch (err) {
    status = 'fail';
    if (err instanceof Error) {
      errorMessage = err.message;
    } else {
      errorMessage = String(err);
    }
    console.warn('Primary brain sync failed, attempting fallback:', err);
    if (base) {
      try {
        const webhook = `${base.replace(/\/?$/, '')}/webhook/brain-update`;
        await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        recoverySteps.push('webhook');
        status = 'pending';
      } catch (e) {
        console.warn('Fallback webhook failed:', e);
      }
    }
    try {
      const { runMaggieWorkflow } = await import('../runMaggie.ts');
      await runMaggieWorkflow();
      recoverySteps.push('runMaggieWorkflow');
      status = status === 'fail' ? 'pending' : status;
    } catch (inner) {
      console.warn('runMaggie fallback failed:', inner);
    }
    throw err;
  } finally {
    const sheetStatus = status === 'fail' ? 'fail' : status === 'pending' ? 'prepared' : 'success';
    await Promise.all([
      logBrainSyncToSheet({
        kvKey,
        status: sheetStatus,
        trigger: update.trigger,
        source: context,
        timestamp: attemptAt,
        error: errorMessage,
      }),
      updateBrainStatus({
        lastAttemptAt: attemptAt,
        lastSuccessAt: status === 'success' ? attemptAt : undefined,
        lastFailureAt: status === 'fail' ? attemptAt : undefined,
        status,
        trigger: update.trigger,
        source: context,
        kvKey,
        sizeBytes,
        error: errorMessage,
      }),
      status === 'fail'
        ? logErrorToSheet({
            module: 'BrainSync',
            error: errorMessage || 'brain update failed',
            recovery: recoverySteps.join(' → ') || undefined,
            timestamp: attemptAt,
          })
        : Promise.resolve(),
    ]);
  }
}

export default updateBrain;
