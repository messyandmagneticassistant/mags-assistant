import { getConfig } from '../utils/config';
import { logBrain } from './logBrain.ts';

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

  // Try primary worker endpoint
  if (base && key) {
    const url = `${base.replace(/\/?$/, '')}/config?scope=brain`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`Failed to update brain: ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('Primary brain sync failed, attempting fallback:', err);
      try {
        const webhook = `${base.replace(/\/?$/, '')}/webhook/brain-update`;
        await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        console.warn('Fallback webhook failed:', e);
        try {
          const { runMaggieWorkflow } = await import('../runMaggie.ts');
          await runMaggieWorkflow();
        } catch (inner) {
          console.warn('runMaggie fallback failed:', inner);
        }
      }
    }
  }
}

export default updateBrain;
