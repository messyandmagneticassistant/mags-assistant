import { BotSession } from '../types';
import { postThread } from '../../postThread';

import { simulateUploadViaBrowser } from './upload-methods/simulateUploadViaBrowser';
import { simulateUploadViaApi } from './upload-methods/simulateUploadViaApi';
import { processWithCapCut } from './capcut-uploader';

const RAW_CLIP = process.env.CAPCUT_RAW_FOLDER || 'uploads/maggie/raw/default.mp4';
const EXPORT_DIR = process.env.CAPCUT_EXPORT_FOLDER || 'uploads/maggie/exported';

export async function uploadToTikTok(
  bot: BotSession,
  config: Record<string, any> = {}
): Promise<{ success: boolean; title?: string }> {
  const useApi = config?.uploadMethod === 'api';
  const method = useApi ? 'API' : 'Browser';
  const useCapCut = config?.useCapCut !== false; // defaults to true

  try {
    if (useCapCut) {
      await postThread({
        bot,
        message: '🎬 CapCut enhancement enabled. Processing raw footage...',
      });

      const renderedPath = await processWithCapCut(RAW_CLIP, EXPORT_DIR);

      await postThread({
        bot,
        message: `✨ CapCut rendering complete: ${renderedPath}`,
      });

      config.videoPath = renderedPath; // pass into upload
    }

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