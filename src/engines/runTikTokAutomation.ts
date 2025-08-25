import { type BotSession } from '../types';
import { postThread } from '../../postThread';
import { uploadNextPost } from '../tiktok/uploadNextPost';
import { boostWithAlts } from '../tiktok/boostWithAlts';
import { checkAndFixFlops } from '../tiktok/checkAndFixFlops';

export async function runTikTokAutomation({
  bot,
  supportBots,
  config,
}: {
  bot: BotSession;
  supportBots: Record<string, BotSession>;
  config: Record<string, any>;
}) {
  try {
    await postThread({
      bot,
      message: '📤 Uploading next post to TikTok...',
    });

    const postResult = await uploadNextPost(bot);

    if (!postResult.success) {
      throw new Error(`Upload failed: ${postResult.message}`);
    }

    await postThread({
      bot,
      message: `✅ Post uploaded: ${postResult.message}`,
    });

    // 🚀 Booster engagement
    if (config.autoBoost !== false) {
      await boostWithAlts({
        targetUsername: bot.username,
        supportBots,
      });

      await postThread({
        bot,
        message: '🚀 Booster bots engaged.',
      });
    }

    // 🛠️ Flop detection & auto-repost
    if (config.autoFixFlops) {
      await checkAndFixFlops(bot);
      await postThread({
        bot,
        message: '🔁 Checked and fixed any flops.',
      });
    }

  } catch (err) {
    console.error('[runTikTokAutomation] fatal error:', err);
    await postThread({
      bot,
      message: `❌ TikTok automation error: ${err.message || err}`,
    });
  }
}