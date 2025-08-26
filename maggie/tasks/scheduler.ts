// maggie/tasks/scheduler.ts

import { postNextVideo } from './post-next';
import { tgSend } from '../../lib/telegram';

let isRunning = false;
const POST_INTERVAL_MS = 3 * 60 * 1000; // change this to 1–2 min if you want to go aggressive

export async function scheduleNextPost() {
  if (isRunning) return;
  isRunning = true;

  console.log('[scheduler] Starting Maggie’s infinite post loop...');
  await tgSend('🚀 Maggie is now auto-posting. Infinite loop engaged.');

  while (true) {
    try {
      const result = await postNextVideo();

      if (result?.success) {
        console.log(`[scheduler] ✅ Posted: ${result.title}`);
        await tgSend(`✅ Maggie posted:\n<b>${result.title}</b>`);
      } else {
        console.warn('[scheduler] ⚠️ Nothing to post right now.');
        await tgSend(`⚠️ Maggie found nothing to post. Will retry.`);
      }
    } catch (err) {
      console.error('[scheduler] ❌ Post error:', err);
      await tgSend(`❌ Maggie post error:\n<code>${String(err)}</code>`);
    }

    await sleep(POST_INTERVAL_MS);
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}