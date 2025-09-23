// 📍 File: src/telegram/handleCommand.ts

import { dispatch } from '../maggie/intent-router';
import { reportStatus } from '../lib/reportStatus';
import { sendTelegramMessage } from '../../lib/telegram.ts';
import { routeTelegramCommand } from './router';

export interface TelegramHandleOptions {
  chatId?: string;
  reply?: (message: string) => Promise<void>;
}

export async function handleTelegramCommand(text: string, options: TelegramHandleOptions = {}) {
  const trimmed = text.trim();
  const normalized = trimmed.toLowerCase();
  const chatId = options.chatId;
  const reply = options.reply || ((message: string) => sendTelegramMessage(message, chatId));

  if (normalized === '/start') {
    await reply('👋 Maggie is online and listening.');
    return;
  }

  const handled = await routeTelegramCommand({ text: trimmed, chatId, reply });
  if (handled) return;

  await reportStatus(`📩 Command received: <code>${trimmed}</code>`);
  await dispatch(trimmed, { source: 'telegram' });
}
