// maggie/intent-router.ts

import { tgSend } from '../lib/telegram';
import { runMaggie } from './index';
import { buildMaggieStatusMessage } from './status';

export async function dispatch(message: string, options: { source: string }) {
  const text = message.trim().toLowerCase();

  if (text === '/help') {
    const helpText = `
🧠 <b>Maggie Help Menu</b>

Commands you can try:
  /status — Show system status
  /maggie-status — Detailed task + queue summary
  /run — Force Maggie to run now
  /help — Show this menu
    `.trim();
    await tgSend(helpText);
    return 'Sent help menu.';
  }

  if (text === '/status' || text === '/maggie-status') {
    const statusMessage = await buildMaggieStatusMessage();
    await tgSend(statusMessage);
    return 'Reported status.';
  }

  if (text === '/run') {
    await tgSend('⚙️ Running Maggie now...');
    await runMaggie({ force: true, source: 'telegram' });
    return 'Triggered Maggie run.';
  }

  await tgSend("🤖 Unknown command. Try /help.");
  return 'Unknown command.';
}