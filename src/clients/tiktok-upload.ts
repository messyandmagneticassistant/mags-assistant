import { BotSession } from '../types';
import { postThread } from '../../postThread';

import { simulateUploadViaBrowser } from './upload-methods/simulateUploadViaBrowser';
import { simulateUploadViaApi } from './upload-methods/simulateUploadViaApi';
import { runBrowserlessCapCut } from '../clients/runBrowserlessCapCut';
import { generateFullCaptionBundle } from '../brains/caption-brain';

const RAW_CLIP = process.env.CAPCUT_RAW_FOLDER || 'uploads/maggie/raw/default.mp4';
const EXPORT_DIR = process.env.CAPCUT_EXPORT_FOLDER || 'uploads/maggie/exported';

export async function uploadToTikTok(
  bot: BotSession,
  config: Record<string, any> = {}
): Promise<{ success: boolean; title?: string }> {
  const useApi = config?.uploadMethod === 'api';
  const method = useApi ? 'API' : 'Browser';
  const useCapCut = config?.useCapCut !== false;

  try {
    // 🧠 Generate caption, overlay, hashtags, first comment
    const bundle = await generateFullCaptionBundle({
      persona: bot.profile,
      videoTheme: config.videoTheme || 'default chaos',
      tone: config.tone || 'realistic mom chaos',
    });

    config.caption = bundle.caption;
    config.hashtags = bundle.hashtags;
    config.firstComment = bundle.firstComment;
    config.overlay = bundle.overlay;

    await postThread({
      bot,
      message: `🧠 Caption bundle generated:\n\n${bundle.caption}\n\n#${bundle.hashtags.join(' #')}`,
    });

    // 🎬 Render video with CapCut if enabled
    if (useCapCut) {
      await postThread({
        bot,
        message: '🎬 CapCut enhancement enabled. Rendering via Browserless...',
      });

      const renderedPath = await runBrowserlessCapCut(RAW_CLIP, EXPORT_DIR);

      await postThread({
        bot,
        message: `✨ CapCut rendering complete. File ready: ${renderedPath}`,
      });

      config.videoPath = renderedPath;
    }

    // 📤 Upload to TikTok
    await postThread({
      bot,
      message: `📤 Uploading via ${method}...`,
    });

    const result = useApi
      ? await simulateUploadViaApi(bot, config)
      : await simulateUploadViaBrowser(bot, config);

    if (!result?.success) throw new Error('Upload method failed or returned no success.');

    await postThread({
      bot,
      message: `✅ Uploaded: ${result.title || 'Untitled Post'} via ${method}`,
    });

    return {
      success: true,
      title: result.title || 'Untitled Post',
    };
  } catch (err) {
    console.error('[uploadToTikTok] Upload error:', err);
    await postThread({
      bot,
      message: `❌ Upload failed via ${method}: ${err.message || err}`,
    });

    return {
      success: false,
      title: undefined,
    };
  }
}