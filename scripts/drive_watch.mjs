// Polls Google Drive for new videos in "Raw Clips" folder, queues them to Worker, and logs state in a GitHub Issue.

import { google } from 'googleapis';
import fetch from 'node-fetch';

const {
  GITHUB_TOKEN,
  REPO_OWNER,
  REPO_NAME,
  GDRIVE_SA_JSON,
  RAW_CLIPS_FOLDER_ID,
  WORKER_URL,
  CRON_SECRET,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
} = process.env;

const ISSUE_TITLE = 'Drive Watcher State';
const RAW_FOLDER_NAME = 'Raw Clips';
const VIDEO_QUERY = "mimeType contains 'video/' and trashed = false";
const MAX_FILES = 25;

function b64Maybe(json) {
  try { return JSON.parse(Buffer.from(json, 'base64').toString('utf8')); }
  catch { return JSON.parse(json); }
}

function gh(url, opts={}) {
  return fetch(`https://api.github.com${url}`, {
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json' },
    ...opts,
  });
}

async function getOrCreateStateIssue() {
  // find open issue with our title
  const res = await gh(`/repos/${REPO_OWNER}/${REPO_NAME}/issues?state=open&per_page=100`);
  const issues = await res.json();
  let issue = Array.isArray(issues) ? issues.find(i => i.title === ISSUE_TITLE) : null;
  if (!issue) {
    const created = await gh(`/repos/${REPO_OWNER}/${REPO_NAME}/issues`, {
      method: 'POST', body: JSON.stringify({ title: ISSUE_TITLE, body: '{"lastSeen":"1970-01-01T00:00:00Z"}' })
    }).then(r=>r.json());
    issue = created;
  }
  return issue;
}

async function readState(issueNumber) {
  const res = await gh(`/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issueNumber}`);
  const issue = await res.json();
  try { return JSON.parse(issue.body || '{}'); } catch { return { lastSeen: '1970-01-01T00:00:00Z' }; }
}

async function writeState(issueNumber, state) {
  await gh(`/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issueNumber}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: JSON.stringify(state, null, 2) })
  });
}

async function telegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }) });
}

async function authDrive() {
  const creds = b64Maybe(GDRIVE_SA_JSON);
  const scopes = ['https://www.googleapis.com/auth/drive.readonly'];
  const jwt = new google.auth.JWT(creds.client_email, null, creds.private_key, scopes);
  await jwt.authorize();
  return google.drive({ version: 'v3', auth: jwt });
}

async function findRawFolderId(drive) {
  if (RAW_CLIPS_FOLDER_ID) return RAW_CLIPS_FOLDER_ID;
  const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${RAW_FOLDER_NAME}' and trashed = false`;
  const res = await drive.files.list({ q, fields: 'files(id, name)', pageSize: 10 });
  if (!res.data.files?.length) throw new Error(`Folder "${RAW_FOLDER_NAME}" not found. Set RAW_CLIPS_FOLDER_ID secret.`);
  return res.data.files[0].id;
}

async function listNewVideos(drive, folderId, sinceISO) {
  const q = `'${folderId}' in parents and ${VIDEO_QUERY} and modifiedTime > '${sinceISO}'`;
  const res = await drive.files.list({
    q, orderBy: 'modifiedTime desc', pageSize: MAX_FILES,
    fields: 'files(id,name,modifiedTime,webViewLink,webContentLink)',
  });
  return res.data.files || [];
}

async function queueToWorker(file) {
  if (!WORKER_URL) return { ok: false, reason: 'WORKER_URL missing' };
  const url = `${WORKER_URL}/api/queue`;
  const body = {
    source: 'drive',
    file_id: file.id,
    name: file.name,
    modifiedTime: file.modifiedTime,
    webViewLink: file.webViewLink,
    webContentLink: file.webContentLink,
  };
  const headers = { 'content-type': 'application/json' };
  if (CRON_SECRET) headers['x-mags-key'] = CRON_SECRET;
  const res = await fetch(url, { method:'POST', headers, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

(async () => {
  try {
    const issue = await getOrCreateStateIssue();
    const state = await readState(issue.number);
    const since = state.lastSeen || '1970-01-01T00:00:00Z';

    const drive = await authDrive();
    const folderId = await findRawFolderId(drive);
    const files = await listNewVideos(drive, folderId, since);

    if (!files.length) {
      await telegram('📭 Drive Watch: no new videos.');
      console.log('No new files since', since);
      return;
    }

    // process newest → oldest, update lastSeen to newest modifiedTime
    let newestISO = since;
    for (const f of files) {
      newestISO = (new Date(f.modifiedTime) > new Date(newestISO)) ? f.modifiedTime : newestISO;
      const res = await queueToWorker(f);
      await telegram(
        `🎬 Detected: ${f.name}\n🕒 ${f.modifiedTime}\n🔗 ${f.webViewLink}\n${res.ok ? '✅ queued' : `⚠️ not queued (${res.status})`}`
      );
      console.log('Processed', f.name, res);
    }

    await writeState(issue.number, { lastSeen: newestISO, countProcessed: files.length, lastRun: new Date().toISOString() });
    console.log('Updated state to', newestISO);

  } catch (err) {
    console.error(err);
    await telegram(`❌ Drive Watch error: ${String(err && err.message || err)}`);
    process.exitCode = 1;
  }
})();

