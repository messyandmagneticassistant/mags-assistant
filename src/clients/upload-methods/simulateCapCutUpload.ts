import { chromium } from 'playwright'; // via Browserless
import fs from 'fs/promises';
import path from 'path';
import { postThread } from '../../postThread';
import { BotSession } from '../types';

const USE_CAPCUT = process.env.USE_CAPCUT === 'true';
const TEMPLATE = process.env.CAPCUT_TEMPLATE || 'trending';
const RAW_FOLDER = process.env.CAPCUT_RAW_FOLDER || 'uploads/maggie/raw';
const EXPORT_FOLDER = process.env.CAPCUT_EXPORT_FOLDER || 'uploads/maggie/exported';

export async function simulateCapCutUpload(bot: BotSession): Promise<{ success: boolean; file?: string }> {
  if (!USE_CAPCUT) {
    console.log('[CapCut] Skipped: CAPCUT is disabled in env.');
    return { success: false };
  }

  try {
    await postThread({
      bot,
      message: `🎬 Maggie is using CapCut with the "${TEMPLATE}" template...`,
    });

    const browser = await chromium.connectOverCDP({
      wsEndpoint: 'wss://chrome.browserless.io?token=' + process.env.BROWSERLESS_API_KEY,
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Go to template list page
    await page.goto(`https://www.capcut.com/template?search=${encodeURIComponent(TEMPLATE)}`);
    await page.waitForTimeout(5000);

    // 2. Click first template
    const templateLink = await page.locator('a[href*="template-detail"]').first();
    await templateLink.click();
    await page.waitForTimeout(4000);

    // 3. Click “Use template”
    await page.locator('button:has-text("Use template")').click();
    await page.waitForTimeout(5000);

    // 4. Upload first video in RAW_FOLDER
    const files = await fs.readdir(RAW_FOLDER);
    const firstVideo = files.find((f) => f.endsWith('.mp4') || f.endsWith('.mov'));
    if (!firstVideo) throw new Error('No video file found in raw folder.');

    const uploadInput = await page.locator('input[type="file"]').first();
    await uploadInput.setInputFiles(path.join(RAW_FOLDER, firstVideo));
    await page.waitForTimeout(10000); // upload + render

    // 5. Export video
    await page.locator('button:has-text("Export")').click();
    await page.waitForTimeout(10000); // allow render

    // 6. Try to auto-download
    const downloadButton = await page.locator('button:has-text("Download")').first();
    const downloadExists = await downloadButton.isVisible();

    if (downloadExists) {
      await downloadButton.click();
      await page.waitForTimeout(8000);

      await postThread({
        bot,
        message: `📥 CapCut download clicked. Waiting for file...`,
      });
    } else {
      console.warn('[CapCut] No visible download button found.');
    }

    // ⛔ You can implement download tracking later here if needed
    // e.g., monitor the Downloads folder or use browser download path

    await browser.close();

    return {
      success: true,
      file: path.join(EXPORT_FOLDER, 'default.mp4'), // placeholder
    };
  } catch (err) {
    console.error('[simulateCapCutUpload] error:', err);
    return { success: false };
  }
}