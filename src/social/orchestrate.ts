import fs from 'fs';
import { schedule } from './scheduler';
import { refreshTrends, nextOpportunities } from './trends';
import { kvKeys, getJSON, setJSON } from '../lib/kv';
import { ensureDefaults, pickVariant } from './abtest';
import { tgSend } from '../lib/telegram';
import { download } from '../lib/storage';
import { applyCapcut } from '../lib/capcut';
import { ensureSafe, classifyFrame, redactRegion } from '../lib/mediaSafety';

const ext = (u: string) => {
  try {
    const p = new URL(u).pathname.split('.');
    return p.length > 1 ? '.' + p.pop() : '';
  } catch {
    return '';
  }
};

async function fetchDriveQueue(): Promise<string[]> {
  return [];
}

const QUEUE_DIR = process.env.QUEUE_DIR ?? 'tmp';
const queuePath = `${QUEUE_DIR}/queue.json`;

export async function runScheduled(env: any, opts: { dryrun?: boolean } = {}) {
  await ensureDefaults(env);
  const live = env.ENABLE_SOCIAL_POSTING === 'true' && !opts.dryrun;
  const mode = live ? 'LIVE' : 'DRYRUN';

  const last = await env.BRAIN.get('tiktok:trends:updatedAt');
  if (!last || Date.now() - Number(last) > 60 * 60 * 1000) {
    await refreshTrends(env);
  }

  const now = new Date();
  const opportunities = await nextOpportunities(env, now, 'MAIN');
  const boostRules = await getJSON(env, kvKeys.boostRules, {} as any);
  const drafts = await getJSON(env, kvKeys.draftQueue, [] as any[]);

  const queue: any[] = fs.existsSync(queuePath)
    ? JSON.parse(fs.readFileSync(queuePath, 'utf8'))
    : [];
  const driveFiles = await fetchDriveQueue();
  for (const f of driveFiles) queue.push({ file: f });

  const planned: any[] = [];

  for (const opp of opportunities) {
    let asset = drafts.shift() || queue.shift();
    if (!asset) continue;
    let local = await download(asset.file || asset);

    try {
      const cls = await classifyFrame(local);
      if (!cls.safe) await redactRegion(local, cls);
    } catch {}

    const report = await ensureSafe(local);
    if (report.status === 'rejected') {
      await tgSend('❌ Rejected: ' + report.reason + '\n' + (report.link || ''));
      continue;
    }
    if (report.status === 'fixed') {
      local = report.file || report.path || local;
    }

    const edited = await applyCapcut(local);
    const variant = await pickVariant(edited);
    const caption = variant?.value || '';
    const when = new Date(Date.now() + variant.bestDelayMs);

    if (live) {
      await schedule({ fileUrl: edited, caption, whenISO: when.toISOString(), variant });
      await setJSON(env, kvKeys.ledger, { last: new Date().toISOString() });
    } else {
      planned.push({ opp, when, caption });
    }

    console.log(`[orchestrate] ${mode} scheduled`, opp.hashtag || opp.id, 'at', when.toISOString());
  }

  if (live) {
    await setJSON(env, kvKeys.draftQueue, drafts);
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  }

  const helpers = ['WILLOW', 'MAGGIE', 'MARS'];
  for (const h of helpers) {
    for (const rule of boostRules.helperActions || []) {
      console.log(`[boost] ${h} will`, rule.actions.join(','), `at +${rule.atMin}m`);
    }
  }

  try {
    await tgSend(`[social] ${mode} planned ${planned.length} posts`);
  } catch {}

  return planned;
}

if (import.meta.main) {
  const env: any = (globalThis as any).env || {
    BRAIN: { get: async () => null, put: async () => {} },
  };
  const cliDry = process.argv.includes('--dryrun');
  runScheduled(env, { dryrun: cliDry }).catch((err) => {
    console.error(err);
  });
}
