import { BotSession } from '../../types';
import { postThread } from '../../postThread';

// Future API endpoint for direct TikTok uploads (replace when available)
const TIKTOK_API_UPLOAD_URL = process.env.TIKTOK_API_UPLOAD_URL || 'https://api.tiktok.com/fake-upload-endpoint';

export async function simulateUploadViaApi(
  bot: BotSession,
  config: Record<string, any>
): Promise<{ success: boolean; title?: string }> {
  console.log('[simulateUploadViaApi] Attempting API-based upload...');

  // Log key content for debugging
  console.log('🧠 Upload config:', {
    caption: config.caption,
    hashtags: config.hashtags,
    overlay: config.overlay,
    firstComment: config.firstComment,
    videoPath: config.videoPath,
  });

  try {
    const formData = new FormData();
    formData.append('video', config.videoBlob || config.videoPath); // You can customize this to support local file blobs
    formData.append('caption', config.caption || '');
    formData.append('hashtags', (config.hashtags || []).join(', '));
    formData.append('firstComment', config.firstComment || '');
    formData.append('overlay', config.overlay || '');

    const response = await fetch(TIKTOK_API_UPLOAD_URL, {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();

    if (result.success) {
      await postThread({
        bot,
        message: `📤 API upload succeeded! "${config.caption}"`,
      });

      return {
        success: true,
        title: config.caption,
      };
    } else {
      console.warn('[simulateUploadViaApi] Upload failed:', result);
      await postThread({
        bot,
        message: `❌ API upload failed: ${result.error || 'Unknown error'}`,
      });

      return { success: false };
    }
  } catch (err) {
    console.error('[simulateUploadViaApi] API error:', err);

    await postThread({
      bot,
      message: `⚠️ Error during API upload: ${err.message}`,
    });

    return { success: false };
  }
}