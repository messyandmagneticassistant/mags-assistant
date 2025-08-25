import { getDrive } from './google.js';
import { env, requireEnv } from './env.js';
import crypto from 'crypto';

// in-memory store of pending approvals
const pending = new Map();

function signToken(fileId) {
  const secret = requireEnv('TELEGRAM_CALLBACK_SECRET');
  return crypto.createHmac('sha256', secret).update(fileId).digest('hex');
}

async function sendTelegram(file, token) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const approveUrl = `${env.API_BASE || ''}/api/approve?fileId=${file.id}&token=${token}`;
  const declineUrl = `${env.API_BASE || ''}/api/decline?fileId=${file.id}&token=${token}`;
  const body = {
    chat_id: env.TELEGRAM_CHAT_ID,
    text: `New video: ${file.name}`,
    reply_markup: {
      inline_keyboard: [[
        { text: 'Approve', url: approveUrl },
        { text: 'Decline', url: declineUrl },
      ]],
    },
  };
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('telegram send failed', err);
  }
}

export async function enqueueNewVideos() {
  const drive = await getDrive();
  const q = `'${requireEnv('MM_DRIVE_INBOX_ID')}' in parents and mimeType contains 'video/' and not properties has { key='mm_enqueued' and value='true' }`;
  const res = await drive.files.list({ q, fields: 'files(id, name, size, webViewLink, createdTime)' });
  const files = res.data.files || [];
  for (const file of files) {
    try {
      // move to review
      await drive.files.update({
        fileId: file.id,
        addParents: requireEnv('MM_DRIVE_REVIEW_ID'),
        removeParents: requireEnv('MM_DRIVE_INBOX_ID'),
        fields: 'id'
      });
      // set custom property
      await drive.files.update({
        fileId: file.id,
        requestBody: { properties: { mm_enqueued: 'true' } },
        fields: 'id'
      });
      const token = signToken(file.id);
      pending.set(file.id, { createdAt: Date.now(), token, file });
      await sendTelegram(file, token);
    } catch (err) {
      console.error('enqueue error', err);
    }
  }
  return files.length;
}

export async function handleApprove(fileId, token) {
  const data = pending.get(fileId);
  if (!data) throw new Error('not pending');
  if (signToken(fileId) !== token) throw new Error('bad token');
  const drive = await getDrive();
  await drive.files.update({
    fileId,
    addParents: requireEnv('MM_DRIVE_READY_ID'),
    removeParents: requireEnv('MM_DRIVE_REVIEW_ID'),
    fields: 'id'
  });
  pending.delete(fileId);
  return data.file;
}

export async function handleDecline(fileId, token) {
  const data = pending.get(fileId);
  if (!data) throw new Error('not pending');
  if (signToken(fileId) !== token) throw new Error('bad token');
  const drive = await getDrive();
  await drive.files.update({
    fileId,
    addParents: requireEnv('MM_DRIVE_FAILED_ID'),
    removeParents: requireEnv('MM_DRIVE_REVIEW_ID'),
    fields: 'id'
  });
  pending.delete(fileId);
  return data.file;
}

export async function autoApproveOld() {
  const cutoff = Date.now() - 60 * 60 * 1000; // 60m
  for (const [fileId, data] of pending) {
    if (data.createdAt < cutoff) {
      try {
        await handleApprove(fileId, data.token);
      } catch (err) {
        console.error('auto-approve failed', err);
      }
    }
  }
}

export function getPending() {
  return Array.from(pending.values()).map((p) => ({
    fileId: p.file.id,
    name: p.file.name,
    createdAt: p.createdAt,
  }));
}
