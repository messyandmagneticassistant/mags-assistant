import { schedule } from './scheduler';
import {
  ensureDefaults,
  classifyFrame,
  ensureSafe,
  pickVariant,
  kvKeys,
  getJSON,
  setJSON,
} from './lib/utils';
import { tgSend } from '../lib/telegram';
import { refreshTrends, nextOpportunities } from './trends';
import { applyCapcut } from '../lib/capcut';
import type { Env } from '../../worker/worker';

const ext = (u: string): string => {
  try {
    const p = new URL(u).pathname;
    return p.length > 1 ? '.' + p.split('.').pop()! : '';
  } catch {
    return '';
  }
};

const QUEUE_DIR = process.env.QUEUE_DIR ?? '';
const queuePath = `${QUEUE_DIR}/queue.json`;

export async function runScheduled(env: Env) {
  await ensureDefaults(env);
  const live = !!env.ENABLE_SOCIAL_POSTING;
  if (!env.BRAIN) throw new Error('BRAIN missing');

  await refreshTrends(env);
  const opportunities = await nextOpportunities(env);

  // On Workers, we won’t use fs; we store the queue in KV
  let queue: any[] = [];
  if (QUEUE_DIR) {
    try {
      // @ts-ignore – dev only
      const fs = await import('node:fs');
      if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR, { recursive: true });
      if (fs.existsSync(queuePath)) queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    } catch {}
  } else {
    queue = (await getJSON(env, kvKeys.draftQueue)) ?? [];
  }

  const planned: any[] = [];

  for (const opp of opportunities) {
    // pick an asset (from drive drafts queue)
    let asset = (queue.shift?.() ?? null) || null;
    if (!asset) continue;
    void ext(asset);

    // Safety gate – must pass or be redacted
    try {
      const cls = await classifyFrame(asset);
      if (!cls.safe) {
        const report = await ensureSafe(asset);
        if (report.status === 'rejected') {
          await tgSend('❌ Rejected: ' + (report.reason || '') + '\n' + (report.link || ''));
          continue;
        }
        if (report.status === 'fixed') {
          asset = report.file || report.path || asset;
        }
      }
    } catch {}

    const edited = await applyCapcut(asset);
    const variant = await pickVariant(env, 'caption');
    const caption = variant?.value ?? '';
    const when = new Date(Date.now() + 15 * 60 * 1000); // 15m default
    const whenISO = when.toISOString();

    if (live) {
      await schedule({ fileUrl: edited, caption, whenISO });
      await setJSON(env, kvKeys.lastRun, { whenISO });
    } else {
      planned.push({ opp, whenISO, caption });
    }

    // persist queue (Workers: KV; dev: fs)
    if (QUEUE_DIR) {
      try {
        // @ts-ignore – dev only
        const fs = await import('node:fs');
        if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR, { recursive: true });
        fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
      } catch {}
    } else {
      await setJSON(env, kvKeys.draftQueue, queue);
    }
  }

  return { ok: true, planned };
}

if (import.meta.main) {
  const env: any = (globalThis as any).env || {
    BRAIN: { get: async () => null, put: async () => {} },
  };
  runScheduled(env).catch((err) => {
    console.error(err);
  });
}
