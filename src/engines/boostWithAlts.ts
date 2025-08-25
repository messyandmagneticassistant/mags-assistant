import { BotSession } from '../types';
import { postThread } from '../../postThread';
import { boostPostWithAlts } from '../clients/tiktok-boost'; // this runs the browser actions or API

export async function boostWithAlts(
  bot: BotSession,
  supportBots: Record<string, BotSession>,
  config: Record<string, any>
) {
  try {
    await postThread({
      bot,
      message: '🚀 Booster accounts engaging with main post...',
    });

    const boostResult = await boostPostWithAlts(bot, supportBots);

    if (boostResult?.success) {
      await postThread({
        bot,
        message: `✅ Boost complete: ${boostResult.summary || 'All boosters engaged'}`,
      });
    } else {
      throw new Error('Booster run failed or returned no result');
    }
  } catch (err) {
    console.error('[boostWithAlts] failed:', err);
    await postThread({
      bot,
      message: `❌ Boosters failed: ${err.message || err}`,
    });
  }
}