import fs from 'fs/promises';
import path from 'path';
import { logPDFStatus } from '../../utils/order-log';
import { tgSend } from '../../lib/telegram';
import { getConfig } from '../../utils/config';

async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function addPDFLinkToNotion(userId: string, link: string) {
  console.log('Add PDF link to Notion', { userId, link });
}

export async function sendTelegramConfirmation(userId: string, link: string) {
  await tgSend(`PDF ready for ${userId}: ${link}`);
}

export const alertDev = async (userId: string) => {
  const devId = process.env.TELEGRAM_DEV_ID;
  if (!devId) return;
  const cfg = await getConfig('telegram').catch(() => ({} as any));
  if (!cfg.botToken) return;
  const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
  const body = { chat_id: devId, text: `PDF incomplete for ${userId}` };
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
};

export const generatePDF = async (userId: string) => {
  console.log('Regenerating PDF for', userId);
};

export async function trackPDFStatus(userId: string) {
  const statusPath = path.join('data', 'reading-status.json');
  try {
    const raw = await fs.readFile(statusPath, 'utf8');
    const data = JSON.parse(raw);
    const entry = data[userId];
    if (!entry) return null;
    const now = Date.now();
    if (entry.status === 'completed' && entry.pdfPath && (await fileExists(entry.pdfPath))) {
      await addPDFLinkToNotion(userId, entry.pdfPath);
      await sendTelegramConfirmation(userId, entry.pdfPath);
      await logPDFStatus(userId, now, true);
      return { success: true, link: entry.pdfPath };
    }
    if (entry.status !== 'completed' && entry.timestamp && now - entry.timestamp > 6 * 60 * 60 * 1000) {
      await alertDev(userId);
      await generatePDF(userId);
      await logPDFStatus(userId, now, false);
      return { success: false, regenerated: true };
    }
  } catch (e) {
    console.warn('trackPDFStatus failed', e);
  }
  return { success: false };
}
