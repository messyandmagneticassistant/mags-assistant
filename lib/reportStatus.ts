// 📍 File: lib/reportStatus.ts

import { sendTelegramMessage } from './telegram';

export async function reportStatus(message: string) {
  const timestamp = new Date().toLocaleString();
  await sendTelegramMessage(`🛰️ <b>Maggie Status</b>\n\n${message}\n\n🕰️ <i>${timestamp}</i>`);
}