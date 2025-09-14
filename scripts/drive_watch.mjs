import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';
import { sendTelegram } from './lib/telegram.mjs';

const {
  GOOGLE_SA_JSON,
  RAW_CLIPS_FOLDER_ID,
  NOTION_TOKEN,
  HQ_DATABASE_ID,
  GAS_INTAKE_URL,
  API_BASE
} = process.env;

const CACHE_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'drive_seen.json');

async function readCache() {
  try {
    const txt = await fs.readFile(CACHE_FILE, 'utf8');
    return JSON.parse(txt);
  } catch {
    return [];
  }
}

async function writeCache(cache) {
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function parseSA(json) {
  try { return JSON.parse(json); } catch {
    return JSON.parse(Buffer.from(json, 'base64').toString('utf8'));
  }
}

async function listDrive() {
  if (!GOOGLE_SA_JSON || !RAW_CLIPS_FOLDER_ID) return [];
  const creds = parseSA(GOOGLE_SA_JSON);
  const jwt = new google.auth.JWT(creds.client_email, null, creds.private_key, ['https://www.googleapis.com/auth/drive.readonly']);
  await jwt.authorize();
  const drive = google.drive({ version: 'v3', auth: jwt });
  const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const q = `'${RAW_CLIPS_FOLDER_ID}' in parents and mimeType contains 'video/' and trashed = false and createdTime > '${since}'`;
  const res = await drive.files.list({ q, fields: 'files(id,name,size,createdTime)', pageSize: 50 });
  return res.data.files || [];
}

async function listFallback() {
  if (!GAS_INTAKE_URL) return [];
  try {
    const res = await fetch(`${GAS_INTAKE_URL}?task=listRaw`);
    return await res.json();
  } catch {
    return [];
  }
}

async function queueFile(file) {
  try {
    if (API_BASE) {
      await fetch(`${API_BASE}/api/command/queueClip`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ driveId: file.id, name: file.name, size: file.size })
      });
      return true;
    }
    if (GAS_INTAKE_URL) {
      await fetch(`${GAS_INTAKE_URL}?task=queue&fileId=${file.id}&name=${encodeURIComponent(file.name)}`);
      return true;
    }
  } catch (err) {
    console.error('queue error', err);
  }
  return false;
}

async function notionLog(file) {
  if (!NOTION_TOKEN || !HQ_DATABASE_ID) return;
  const headers = {
    'Authorization': `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };
  const body = {
    parent: { database_id: HQ_DATABASE_ID },
    properties: {
      Title: { title: [{ text: { content: file.name } }] },
      Status: { select: { name: 'Queued' } },
      Source: { select: { name: 'Drive' } },
      SizeMB: { number: file.sizeMB },
      Created: { date: { start: file.createdTime } }
    }
  };
  try {
    await fetch('https://api.notion.com/v1/pages', { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (err) {
    console.warn('notion error', err);
  }
}

(async () => {
  const cache = await readCache();
  const seen = new Set(cache.map(x => x.id));
  let files = [];
  try {
    files = await listDrive();
    if (!files.length) files = await listFallback();
  } catch {
    files = await listFallback();
  }
  const newOnes = files.filter(f => !seen.has(f.id));
  const summaries = [];
  for (const f of newOnes) {
    const sizeMB = f.size ? +(Number(f.size) / (1024 * 1024)).toFixed(2) : undefined;
    const queued = await queueFile(f);
    summaries.push({ name: f.name, id: f.id, sizeMB, createdTime: f.createdTime });
    if (queued) {
      cache.push({ id: f.id, name: f.name });
      await notionLog({ name: f.name, sizeMB, createdTime: f.createdTime });
    }
  }
  if (newOnes.length) await writeCache(cache);
  if (summaries.length) {
    const first = summaries[0];
    await sendTelegram(`🎬 Mags queued ${summaries.length} new raw clips\n${first.name} (${first.sizeMB ?? '?' } MB) ${first.createdTime}`);
  } else {
    await sendTelegram('No new clips');
  }
})().catch(err => console.error(err));
