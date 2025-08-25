import { BotSession } from '../types';
import { postThread } from '../../postThread';
import { uploadToTikTok } from '../clients/tiktok-upload'; // this wraps the actual browser/API upload logic

export async function uploadNextPost(bot: BotSession, config: Record<string, any>) {
  try {
    await postThread({
      bot,
      message: '📤 Uploading next TikTok post...',
    });

    const uploadResult = await uploadToTikTok(bot);

    if (uploadResult?.success) {
      await postThread({
        bot,
        message: `✅ Uploaded: ${uploadResult.title || 'Unnamed post'}`,
      });
    } else {
      throw new Error('Upload failed or returned no result');
    }
  } catch (err) {
    console.error('[uploadNextPost] failed:', err);
    await postThread({
      bot,
      message: `❌ Failed to upload next post: ${err.message || err}`,
    });
  }
}