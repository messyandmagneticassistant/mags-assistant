// src/utils/browser-actions/runBrowserUploadFlow.ts

import { BotSession } from '../../types';
import { BROWSERLESS_BASE_URL, BROWSERLESS_API_KEY } from '../../config';

export async function runBrowserUploadFlow(
  bot: BotSession
): Promise<{ success: boolean; title?: string; error?: string }> {
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

            await page.setCookie(...session.cookies);

            await page.goto('https://www.tiktok.com/upload?lang=en', { waitUntil: 'networkidle' });
            await page.waitForSelector('input[type="file"]', { timeout: 15000 });

            const input = await page.$('input[type="file"]');
            await input.setInputFiles(path.resolve(videoPath));
            await page.waitForTimeout(10000);

            const textarea = await page.$('textarea');
            if (textarea) {
              await textarea.fill(caption);
            }

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
          caption: bot.caption || '✨ Auto-uploaded by Maggie ✨',
        },
      }),
    });

    const result = await response.json();

    if (!result || !result.success) {
      return { success: false, error: 'Browserless script failed or incomplete' };
    }

    return result;
  } catch (err) {
    console.error('[runBrowserUploadFlow] Error:', err);
    return { success: false, error: err.message || 'Unknown error' };
  }
}