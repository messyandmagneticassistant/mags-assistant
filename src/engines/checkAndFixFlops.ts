import { BotSession } from '../types';
import { postThread } from '../../postThread';
import { getLatestPostStats, deletePost, reuploadPost } from '../clients/tiktok-posting';
import { getCaptionSuggestions } from '../clients/caption-generator';

export async function checkAndFixFlops(
  bot: BotSession,
  config: Record<string, any> = {}
): Promise<{ success: boolean; message: string }> {
  const minViews = config.minViews || 500;
  const minAgeMinutes = config.minAgeMinutes || 45;
  const debug = config.debug || false;

  try {
    await postThread({
      bot,
      message: '📉 Checking for underperforming posts (flops)...',
    });

    const stats = await getLatestPostStats(bot.session);

    if (!stats?.id) throw new Error('No recent post found to evaluate.');

    const { id, views = 0, createdAt } = stats;
    const ageInMinutes = (Date.now() - new Date(createdAt).getTime()) / 60000;
    const isFlop = views < minViews && ageInMinutes > minAgeMinutes;

    if (debug) {
      console.log(`[checkAndFixFlops] views: ${views}, age: ${Math.floor(ageInMinutes)} min, isFlop: ${isFlop}`);
    }

    if (isFlop) {
      await postThread({
        bot,
        message: `⚠️ Flop detected (Views: ${views}, Age: ${Math.floor(ageInMinutes)} min). Reuploading...`,
      });

      await deletePost(bot.session, id);

      const newCaption = await getCaptionSuggestions(bot.username);

      await reuploadPost({
        session: bot.session,
        username: bot.username,
        caption: newCaption,
        useAltAudio: true,
      });

      await postThread({
        bot,
        message: '🔁 Post re-uploaded with new caption and timing.',
      });

      return {
        success: true,
        message: 'Flop fixed and post reuploaded.',
      };
    }

    await postThread({
      bot,
      message: '✅ No flops detected. All posts are performing within range.',
    });

    return {
      success: true,
      message: 'No flop detected. No action taken.',
    };
  } catch (err) {
    console.error('[checkAndFixFlops] error:', err);
    await postThread({
      bot,
      message: `❌ Flop fixer failed: ${err.message || err}`,
    });

    return {
      success: false,
      message: `Flop fixer error: ${err.message || err}`,
    };
  }
}