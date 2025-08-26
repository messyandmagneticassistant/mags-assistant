import { BotSession } from '../../types';
import { BROWSERLESS_BASE_URL, BROWSERLESS_API_KEY } from '../../config';

export async function runBrowserUploadFlow(
  bot: BotSession
): Promise<{ success: boolean; title?: string }> {
  try {
    const response = await fetch(`${BROWSERLESS_BASE_URL}/function`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-API-KEY': BROWSERLESS_API_KEY,
      },
      body: JSON.stringify({
        code: `
          const path = require('path');
          const fs = require('fs');

          module.exports = async ({ page, context }) => {
            const session = context.session;
            const videoPath = context.videoPath || 'uploads/maggie/exported/default.mp4';
            const caption = context.caption || '✨ Auto-uploaded by Maggie ✨';

            // Set TikTok cookies/session
            await page.setCookie(...session.cookies);

            // Navigate to upload page
            await page.goto('https://www.tiktok.com/upload?lang=en', { waitUntil: 'networkidle' });
            await page.waitForSelector('input[type="file"]', { timeout: 15000 });

            // Upload the video
            const input = await page.$('input[type="file"]');
            await input.setInputFiles(path.resolve(videoPath));
            await page.waitForTimeout(10000); // Let TikTok process the upload

            // Type the caption
            const textarea = await page.$('textarea');
            if (textarea) {
              await textarea.fill(caption);
            }

            // Click post
            const postButton = await page.$('button:has-text("Post")');
            if (postButton) {
              await postButton.click();
            } else {
              throw new Error('No Post button found.');
            }

            await page.waitForTimeout(5000);
            return { success: true, title: caption };
          };
        `,
        context: {
          session: bot.session,
          videoPath: bot.lastVideoPath || undefined,
          caption: bot.caption || 'Auto-uploaded by Maggie',
        },
      }),
    });

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('[runBrowserUploadFlow] Browserless error:', err);
    return { success: false };
  }
}