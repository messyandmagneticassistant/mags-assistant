import { BotSession } from '../../types';
import { runBrowserUploadFlow } from '../../utils/browser-actions';

export async function simulateUploadViaBrowser(
  bot: BotSession,
  config: Record<string, any>
): Promise<{ success: boolean; title?: string }> {
  try {
    const result = await runBrowserUploadFlow(bot, config);

    if (!result?.success) {
      throw new Error('Browser upload failed');
    }

    return {
      success: true,
      title: result.title || 'Untitled',
    };
  } catch (err) {
    console.error('[simulateUploadViaBrowser] error:', err);
    return { success: false, title: undefined };
  }
}