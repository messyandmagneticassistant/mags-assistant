import { BotSession } from '../../types';

export async function simulateUploadViaApi(
  bot: BotSession
): Promise<{ success: boolean; title?: string }> {
  console.log('[simulateUploadViaApi] API not supported yet.');
  return {
    success: false,
    title: undefined,
  };
}