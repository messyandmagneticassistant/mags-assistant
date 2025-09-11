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
import { tgSend } from './lib/telegram';
import { refreshTrends, nextOpportunities } from './trends';
import { applyCapcut } from './lib/capcut';
import type { Env } from '../worker/types';

export async function runScheduled(env: Env, opts: { dryrun?: boolean } = {}) {
  await ensureDefaults(env);
  const live = !!env.ENABLE_SOCIAL_POSTING && !opts.dryrun;

  const queue: any[] = await getJSON(env, kvKeys.draftQueue, [] as any[]);
  const planned: any[] = [];

  const now = new Date();
  const profile = 'MESSY_MAIN';
  await refreshTrends(env);
  const opportunities = await nextOpportunities(env, now.getTime(), profile);

  for (const opp of opportunities) {
    let local = queue.shift();
    if (!local) continue;

    try {
      await classifyFrame(local);
    } catch {}

    const report = await ensureSafe(env, local);
    if (report.status === 'rejected') {
      await tgSend(`❌ Rejected: ${report.reason}`);
      continue;
    }
    if (report.status === 'fixed') {
      local = report.file || report.artifactPath || local;
    }

    const edited = await applyCapcut(local);
    const variant = await pickVariant(env, 'caption');
    const caption = variant?.value ?? '';

    const when = new Date(Date.now() + 5 * 60 * 1000);
    const whenISO = when.toISOString();
    if (live) {
      await schedule({ fileUrl: edited, caption, whenISO });
      await setJSON(env, kvKeys.lastScheduled, { whenISO, caption, edited });
    } else {
      planned.push({ opp, whenISO, caption, file: edited });
    }
  }

  await setJSON(env, kvKeys.draftQueue, queue);
  return planned;
}
