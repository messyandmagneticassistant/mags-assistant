import { BotSession } from '../types';
import { postThread } from '../../postThread';
import { getLatestPostStats, deletePost, reuploadPost } from '../clients/tiktok-posting';
import { getCaptionSuggestions } from '../clients/caption-generator';

export async function checkAndFixFlops(bot: BotSession, config: Record<string, any>) {
  try {
    await postThread({
      bot,
      message: '📉 Checking for underperforming posts (flops)...',
    });

    const stats = await getLatestPostStats(bot.session);
    const { id, views, likes, comments, createdAt } = stats || {};

    if (!id) throw new Error('No recent post found to evaluate.');

    const ageInMinutes = (Date.now() - new Date(createdAt).getTime()) / 60000;

    // Define flop logic (can be tweaked)
    const isFlop = views < 500 && ageInMinutes > 45;

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
    } else {
      await postThread({
        bot,
        message: '✅ No flops detected. All posts are performing within range.',
      });
    }
  } catch (err) {
    console.error('[checkAndFixFlops] error:', err);
    await postThread({
      bot,
      message: `❌ Flop fixer failed: ${err.message || err}`,
    });
  }
}