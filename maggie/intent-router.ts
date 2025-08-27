// maggie/intent-router.ts

import { tgSend } from '../lib/telegram';
import { runMaggie } from './index';
import { updateBrain } from '../brain'; // You can stub this for now
// import { runVisualTest } from './tasks/browser-task'; // Uncomment if added

export async function dispatch(input: string, ctx: { source: 'cli' | 'telegram' }) {
  const text = input.trim().toLowerCase();

  if (text.includes('status') || text === '/maggie status') {
    await tgSend(`📊 Maggie is online and healthy.\n• Brain connected\n• Browserless ready\n• Telegram live\n\nType /maggie help for commands.`);
    return 'Status sent';
  }

  if (text.includes('help') || text === '/maggie help') {
    await tgSend(`🧠 Maggie Help:\n\n/maggie status — Show status\n/maggie run — Trigger task cycle\n/maggie reset — Reset brain\n/maggie screenshot — Run browser\n\nAsk me anything!`);
    return 'Help sent';
  }

  if (text.includes('run') || text === '/maggie run') {
    await tgSend(`⚙️ Running Maggie's full cycle...`);
    await runMaggie({ force: true });
    return 'Run triggered';
  }

  if (text.includes('reset') || text === '/maggie reset') {
    await tgSend(`🧼 Resetting memory... (stub)`);
    await updateBrain({ wipe: true }); // Optional: implement
    return 'Memory reset';
  }

  if (text.includes('screenshot') || text === '/maggie screenshot') {
    await tgSend(`📸 Capturing page via Browserless...`);
    // await runVisualTest(); // Uncomment after browser-task is ready
    return 'Screenshot taken';
  }

  // Catch-all: save question to memory, return learning message
  await tgSend(`🤔 I don't recognize that command yet, but I’m learning from it.\nYou said:\n\n“${input}”\n\nSoon I'll respond even smarter.`);
  await updateBrain({ newInput: input, source: ctx.source }); // optional
  return 'Fallback handled';
}