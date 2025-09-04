// src/social/orchestrate.ts
// Main orchestrator deciding whether to post or skip

import fs from 'node:fs';
import path from 'node:path';
import { storePeerAnalytics } from './research';
import { refreshTrends } from './trends';
import { scoreBacklog, ScoredVideo } from './score';

const BASE_URL = process.env.WORKER_BASE_URL || 'https://maggie.messyandmagnetic.com';
const RAW_FOLDER = process.env.RAW_DRIVE_FOLDER || '';

const kvFile = path.join(process.cwd(), 'social-kv.json');
let kv: Record<string, any> = {};
if (fs.existsSync(kvFile)) {
  try {
    kv = JSON.parse(fs.readFileSync(kvFile, 'utf8'));
  } catch {}
}

async function kvGet(key: string) {
  return kv[key];
}
async function kvPut(key: string, val: any) {
  kv[key] = val;
  fs.writeFileSync(kvFile, JSON.stringify(kv, null, 2));
}

async function postVideo(video: ScoredVideo) {
  const res = await fetch(`${BASE_URL}/tiktok/post`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pathOrUrl: video.id, caption: video.name }),
  });
  console.log('[post] status', res.status);
  await kvPut('social:lastPostedAt', Date.now());
  await kvPut('social:lastScore', video.score);
}

async function run(dryrun = false) {
  await storePeerAnalytics(kvPut);
  await refreshTrends(kvPut);
  const scored = await scoreBacklog(RAW_FOLDER, kvGet, kvPut);

  const threshold = 0.68;
  const candidate = scored[0];
  const windowHot = true; // placeholder; real logic should consult analytics
  if (!candidate) {
    console.log('no candidates');
    return;
  }
  console.log('top candidate', candidate);
  if (!dryrun && windowHot && candidate.score >= threshold) {
    await postVideo(candidate);
  } else {
    console.log('skip posting');
  }
}

run(process.argv.includes('--dryrun')).catch((err) => {
  console.error(err);
  process.exit(1);
});
