import { BotSession } from '../types';
import { simulateUploadViaApi } from './simulateUploadViaApi';
import { simulateUploadViaBrowser } from './simulateUploadViaBrowser';
import { postThread } from '../../postThread';

interface UploadOptions {
  caption: string;
  hashtags?: string[];
  overlay?: string;
  firstComment?: string;
  videoPath?: string;
  preferApi?: boolean;
}

export async function uploadWithFallback(
  bot: BotSession,
  options: UploadOptions
): Promise<{ success: boolean; title?: string }> {
  const config = {
    caption: options.caption,
    hashtags: options.hashtags || [],
    overlay: options.overlay || '',
    firstComment: options.firstComment || '',
    videoPath: options.videoPath || 'uploads/maggie/exported/default.mp4',
  };

  // Always store config in bot context
  bot.caption = config.caption;
  bot.hashtags = config.hashtags;
  bot.overlay = config.overlay;
  bot.firstComment = config.firstComment;
  bot.lastVideoPath = config.videoPath;

  const shouldUseApi = options.preferApi || process.env.FORCE_API_UPLOAD === 'true';

  if (shouldUseApi) {
    const apiResult = await simulateUploadViaApi(bot, config);

    if (apiResult.success) {
      return apiResult;
    }

    await postThread({
      bot,
      message: `⚠️ API upload failed. Falling back to browser upload.`,
    });
  }

  return await simulateUploadViaBrowser(bot);
}