import fs from 'fs';
import path from 'path';
import { schedule } from './scheduler';
import { classifyFrame, redactRegions } from './safety';
import { refreshTrends, nextOpportunities } from './trends';
import { kvKeys, getJSON, setJSON, pushLedger } from './kv';
import { ensureDefaults } from './defaults';
import { pickVariant } from './ab';

// transient local queue (legacy drive ingestion)
async function fetchDriveQueue(): Promise<string[]> {
  return [];
}
async function download(_url: string): Promise<string> {
  return _url;
}
async function applyCapCutTemplate(file: string): Promise<string> {
  if (process.env.CAPCUT_TEMPLATE_ID) {
    // integrate CapCut editing here
  }
  return file;
}

const QUEUE_DIR = process.env.QUEUE_DIR ?? 'tmp';
const queuePath = path.join(process.cwd(), QUEUE_DIR, 'queue.json');

const cliDry = process.argv.includes('--dryrun');
const live = process.env.ENABLE_SOCIAL === 'true' && !cliDry;
const mode = live ? 'LIVE' : 'DRYRUN';

async function main() {
  const env: any = (globalThis as any).env || { BRAIN: { get: async () => null, put: async () => {} } };

  await ensureDefaults(env);

  const last = await env.BRAIN.get('tiktok:trends:updatedAt');
  if (!last || Date.now() - Number(last) > 60 * 60 * 1000) {
    await refreshTrends(env);
  }

  const now = new Date();
  const opportunities = await nextOpportunities(env, now, 'MAIN');
  const boostRules = await getJSON(env, kvKeys.boostRules, {} as any);
  const drafts = await getJSON(env, kvKeys.draftQueue, [] as any[]);

  const queue: any[] = fs.existsSync(queuePath) ? JSON.parse(fs.readFileSync(queuePath, 'utf8')) : [];
  const driveFiles = await fetchDriveQueue();
  for (const f of driveFiles) queue.push({ file: f });

  const planned: any[] = [];

  for (const opp of opportunities) {
    // pick asset from draft queue or drive queue
    let asset = drafts.shift() || queue.shift();
    if (!asset) continue;
    const local = await download(asset.file || asset);

    try {
      const buf = fs.readFileSync(local);
      const cls = await classifyFrame(buf);
      if (!cls.safe) await redactRegions(local, cls.regions || []);
    } catch {}

    const edited = await applyCapCutTemplate(local);
    const variant = await pickVariant(env, 'caption');
    const caption = variant?.value || '';
    const when = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    if (live) {
      await schedule({ fileUrl: edited, caption, whenISO: when });
      await pushLedger(env, 'MAIN', { id: opp.id, hashtag: opp.hashtag });
    }

    planned.push({ opp, when, caption });
    console.log(`[orchestrate] ${mode} scheduled`, opp.hashtag || opp.id, 'at', when);
  }

  if (live) {
    await setJSON(env, kvKeys.draftQueue, drafts);
    fs.mkdirSync(path.dirname(queuePath), { recursive: true });
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  }

  // helper boost planning (logged only)
  const helpers = ['WILLOW', 'MAGGIE', 'MARS'];
  for (const h of helpers) {
    for (const rule of boostRules.helperActions || []) {
      console.log(`[boost] ${h} will`, rule.actions.join(','), `at +${rule.atMin}m`);
    }
  }

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    const text = `[social] ${mode} planned ${planned.length} posts`;
    try {
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
      });
    } catch {}
  }
}

main();
