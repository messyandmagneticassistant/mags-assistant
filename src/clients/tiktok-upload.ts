import path from 'path';
import fs from 'fs/promises';
import { BotSession } from '../../types';
import { runBrowserUploadFlow } from './runBrowserUploadFlow';
import { postThread } from '../../postThread';

const EXPORT_FOLDER = process.env.CAPCUT_EXPORT_FOLDER || 'uploads/maggie/exported';

export async function postToTikTok(bot: BotSession): Promise<{ success: boolean; title?: string }> {
  try {
    // Fallback to most recent export if not set
    if (!bot.lastVideoPath) {
      const files = await fs.readdir(EXPORT_FOLDER);
      const sorted = files
        .filter(f => f.endsWith('.mp4') || f.endsWith('.mov'))
        .map(f => ({ name: f, time: fs.stat(path.join(EXPORT_FOLDER, f)).then(s => s.mtimeMs) }));

      const results = await Promise.all(sorted.map(async (f) => ({
        file: f.name,
        time: await f.time,
      })));

      const latest = results.sort((a, b) => b.time - a.time)[0];
      if (!latest) throw new Error('No video file found in export folder.');

      bot.lastVideoPath = path.join(EXPORT_FOLDER, latest.file);
    }

    // Default caption if missing
    if (!bot.caption) {
      bot.caption = '✨ Auto-uploaded by Maggie ✨';
    }

    const attempt = await runBrowserUploadFlow(bot);

    if (!attempt.success) {
      await postThread({
        bot,
        message: `⚠️ TikTok upload failed. Retrying...`,
      });

      const retry = await runBrowserUploadFlow(bot);
      if (!retry.success) {
        throw new Error('Retry failed.');
      }

      return retry;
    }

    return attempt;
  } catch (err) {
    console.error('[postToTikTok] error:', err);
    await postThread({
      bot,
      message: `❌ Maggie could not post the video to TikTok.\n${err}`,
    });

    return { success: false };
  }
}