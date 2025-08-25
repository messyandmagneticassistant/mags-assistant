import { postThread } from '../../postThread';
import { runTikTokAutomation } from '../engines/tiktok-bot';
import { type BotSession } from '../types';

/**
 * This function runs Maggie's TikTok automation loop.
 * Goals include:
 * - Posting to @messyandmagnetic and alt accounts
 * - Boosting engagement via likes/comments/saves from support bots
 * - Detecting flops and re-uploading failed posts
 * - Seeding engagement ladders (comment chains between accounts)
 * - Rotating sessions and simulating human patterns
 * - Preparing future post schedules
 * - Pinning top comments and updating feedback logs
 * - Respecting all safety and brand guardrails
 */

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

  } catch (err: any) {
    console.error('[maggie-tiktok] loop error:', err);
    await postThread({
      bot,
      message: `❌ Maggie TikTok loop failed: ${err.message || err}`,
    });
  }
}