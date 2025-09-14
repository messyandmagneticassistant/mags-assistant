import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getDrive } from '../lib/google';

const rawFolder = process.env.RAW_DRIVE_FOLDER || '';
const workDir = path.join(process.cwd(), 'work', 'incoming');
const cursorPath = path.join(process.cwd(), 'work', 'drive-cursor.json');

fs.mkdirSync(workDir, { recursive: true });

interface Cursor { lastSync?: string }
const cursor: Cursor = fs.existsSync(cursorPath)
  ? JSON.parse(fs.readFileSync(cursorPath, 'utf8'))
  : {};

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error('[drive-watch] telegram error', err);
  }
}

async function queueFile(fileId: string) {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn('python3', ['extract_clips.py', fileId], { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`extract_clips exited with ${code}`));
    });
  });
}

async function run() {
  if (!rawFolder) {
    console.error('[drive-watch] missing RAW_DRIVE_FOLDER');
    return;
  }
  const drive = await getDrive();
  const q = cursor.lastSync
    ? `'${rawFolder}' in parents and mimeType contains 'video/' and modifiedTime > '${cursor.lastSync}'`
    : `'${rawFolder}' in parents and mimeType contains 'video/'`;
  const res = await drive.files.list({ q, fields: 'files(id, name, modifiedTime)', orderBy: 'modifiedTime asc' });
  const files = res.data.files || [];
  for (const file of files) {
    try {
      await queueFile(file.id!);
      await sendTelegram(`Queued video: ${file.name}`);
    } catch (err) {
      console.error('[drive-watch] failed to queue', file.name, err);
    }
  }
  if (files.length) {
    cursor.lastSync = files[files.length - 1].modifiedTime || new Date().toISOString();
    fs.writeFileSync(cursorPath, JSON.stringify(cursor));
  }
  console.log(`[drive-watch] processed ${files.length} new file(s)`);
}

run().catch((err) => {
  console.error('[drive-watch] fatal', err);
  process.exit(1);
});
