import path from 'path';
import fs from 'fs/promises';
import { BotSession } from '../../types';
import { runBrowserUploadFlow } from './runBrowserUploadFlow';
import { generateCaption } from './captionBrain';
import { postThread } from '../../postThread';

const EXPORT_FOLDER = process.env.CAPCUT_EXPORT_FOLDER || 'uploads/maggie/exported';

export async function postToTikTok(bot: BotSession): Promise<{ success: boolean; title?: string }> {
  try {
    // Fallback to most recent export if not set
    if (!bot.lastVideoPath) {
      const files = await fs.readdir(EXPORT_FOLDER);
      const latestFile = files
        .filter(f => f.endsWith('.mp4') || f.endsWith('.mov'))
        .sort((a, b) => {
          const aTime = fs.stat(path.join(EXPORT_FOLDER, a)).then(s => s.mtimeMs);
          const bTime = fs.stat(path.join(EXPORT_FOLDER, b)).then(s => s.mtimeMs);
          return bTime - aTime;
        })[0];

      if (!latestFile) throw new Error('No video file found in export folder.');
      bot.lastVideoPath = path.join(EXPORT_FOLDER, latestFile);
    }

    // Autogenerate caption if missing
    if (!bot.caption) {
      bot.caption = await generateCaption(bot);
    }

    const attempt = await runBrowserUploadFlow(bot);

    if (!attempt.success) {
      await postThread({
        bot,
        message: `⚠️ TikTok upload failed. Retrying...`,
      });

      const retry = await runBrowserUploadFlow(bot);
      if (!retry.success) throw new Error('Retry failed.');

      return retry;
    }

    return attempt;
  } catch (err) {
    console.error('[postToTikTok] error:', err);
    await postThread({
      bot,
      message: `❌ Maggie could not post to TikTok.\n${err}`,
    });
    return { success: false };
  }
}