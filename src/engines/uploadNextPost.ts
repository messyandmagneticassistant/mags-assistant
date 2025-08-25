import { BotSession } from '../types';
import { postThread } from '../../postThread';
import { uploadToTikTok } from '../clients/tiktok-upload';

export async function uploadNextPost(
  bot: BotSession,
  config: Record<string, any> = {}
): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    await postThread({
      bot,
      message: '📤 Uploading next TikTok post...',
    });

    const uploadResult = await uploadToTikTok(bot);

    if (!uploadResult?.success) {
      throw new Error(uploadResult?.error || 'Upload failed or returned no result');
    }

    const title = uploadResult.title || 'Unnamed post';

    await postThread({
      bot,
      message: `✅ Uploaded: ${title}`,
    });

    return {
      success: true,
      message: title,
    };
  } catch (err) {
    const errorMsg = err.message || 'Unknown error during upload';
    console.error('[uploadNextPost] failed:', err);

    await postThread({
      bot,
      message: `❌ Failed to upload next post: ${errorMsg}`,
    });

    return {
      success: false,
      message: errorMsg,
    };
  }
}