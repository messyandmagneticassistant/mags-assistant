// 📍 File: src/telegram/handleCommand.ts

import { dispatch } from '../maggie/intent-router';
import { reportStatus } from '../lib/reportStatus';

export async function handleTelegramCommand(text: string) {
  const trimmed = text.trim();

  // Optionally, add your own commands here
  if (trimmed.toLowerCase() === '/start') {
    await reportStatus('👋 Hello! Maggie is online and listening.');
    return;
  }

  // Handle as if it’s a normal command for dispatch
  await reportStatus(`📩 Command received: <code>${trimmed}</code>`);
  await dispatch(trimmed, { source: 'telegram' });
}