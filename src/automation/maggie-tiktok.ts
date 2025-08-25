import { postThread } from '../../postThread';
import { runTikTokAutomation } from '../engines/tiktok-bot';
import { type BotSession } from '../types';

export async function runMaggieTikTokLoop(
  {
    bot,
    supportBots,
  }: {
    bot: BotSession;
    supportBots: Record<string, BotSession>;
  },
  config: Record<string, any>
) {
  try {
    await postThread({
      bot,
      message: '🧠 Maggie is running her TikTok automation loop...',
    });

    await runTikTokAutomation({ bot, supportBots, config });

    await postThread({
      bot,
      message: '✅ Maggie finished her TikTok loop for this cycle.',
    });
  } catch (err) {
    console.error('[maggie-tiktok] loop error:', err);
    await postThread({
      bot,
      message: `❌ Maggie TikTok loop failed: ${err.message || err}`,
    });
  }
}