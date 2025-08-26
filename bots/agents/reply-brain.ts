import { BotSession } from '../types';
import { postThread } from '../postThread';
import { fetchLatestComments, postReply } from '../utils/tiktok-api';
import { generateReply } from '../utils/generate-reply';

export async function runReplyBrain(bot: BotSession): Promise<void> {
  try {
    await postThread({ bot, message: `🧠 Activating reply brain for ${bot.username}...` });

    const comments = await fetchLatestComments(bot);
    if (!comments.length) {
      await postThread({ bot, message: `💬 No new comments to reply to.` });
      return;
    }

    for (const comment of comments) {
      const reply = await generateReply({
        comment: comment.text,
        persona: bot.persona || 'main',
        context: comment.context || '',
      });

      if (!reply) continue;

      await postReply(bot, comment.id, reply);
      await postThread({
        bot,
        message: `💬 Replied to @${comment.user}: "${reply}"`,
      });
    }
  } catch (err) {
    console.error('[runReplyBrain] Error:', err);
    await postThread({ bot, message: `❌ Reply brain error: ${err.message || err}` });
  }
}