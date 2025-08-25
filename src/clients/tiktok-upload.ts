import { BotSession } from '../types';
import { simulateUploadViaBrowser } from './upload-methods/simulateUploadViaBrowser';
import { simulateUploadViaApi } from './upload-methods/simulateUploadViaApi';

export async function uploadToTikTok(
  bot: BotSession,
  config?: Record<string, any>
): Promise<{ success: boolean; title?: string }> {
  try {
    const useApi = config?.uploadMethod === 'api';

    const result = useApi
      ? await simulateUploadViaApi(bot)
      : await simulateUploadViaBrowser(bot);

    if (!result?.success) {
      throw new Error('Upload failed');
    }

    return {
      success: true,
      title: result.title || 'Untitled Post',
    };
  } catch (err) {
    console.error('[uploadToTikTok] Upload error:', err);
    return {
      success: false,
      title: undefined,
    };
  }
}