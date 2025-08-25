import { BotSession } from '../types';
import { postThread } from '../../postThread';
import { simulateUploadViaBrowser } from './upload-methods/simulateUploadViaBrowser';
import { simulateUploadViaApi } from './upload-methods/simulateUploadViaApi';

export async function uploadToTikTok(
  bot: BotSession,
  config?: Record<string, any>
): Promise<{ success: boolean; title?: string }> {
  const useApi = config?.uploadMethod === 'api';
  const method = useApi ? 'API' : 'Browser';

  try {
    await postThread({
      bot,
      message: `📤 Starting TikTok upload via **${method}**...`,
    });

    const result = useApi
      ? await simulateUploadViaApi(bot)
      : await simulateUploadViaBrowser(bot);

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