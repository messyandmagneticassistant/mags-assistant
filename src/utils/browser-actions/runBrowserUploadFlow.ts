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
          module.exports = async ({ page, context }) => {
            await page.goto('https://www.tiktok.com/upload', { waitUntil: 'networkidle0' });
            // Upload logic here (drag/drop video, caption, etc.)
            // Example: await page.type('textarea', 'My new post 🎉');
            return { success: true, title: 'Auto-uploaded by Maggie' };
          };
        `,
        context: {
          session: bot.session,
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