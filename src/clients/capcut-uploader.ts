import { chromium } from 'playwright'; // via Browserless
import fs from 'fs/promises';
import path from 'path';
import { postThread } from '../../postThread';
import { BotSession } from '../types';

const USE_CAPCUT = process.env.USE_CAPCUT === 'true';
const TEMPLATE = process.env.CAPCUT_TEMPLATE || 'trending';
const RAW_FOLDER = process.env.CAPCUT_RAW_FOLDER || 'uploads/maggie/raw';
const EXPORT_FOLDER = process.env.CAPCUT_EXPORT_FOLDER || 'uploads/maggie/exported';

export async function processWithCapCut(
  inputFile: string = RAW_FOLDER,
  outputFolder: string = EXPORT_FOLDER,
  bot?: BotSession
): Promise<string> {
  if (!USE_CAPCUT) {
    console.log('[CapCut] Skipped: CAPCUT is disabled in env.');
    return inputFile;
  }

  try {
    if (bot) {
      await postThread({
        bot,
        message: `🎬 Maggie is using CapCut with the "${TEMPLATE}" template...`,
      });
    }

    const browser = await chromium.connectOverCDP({
      wsEndpoint: 'wss://chrome.browserless.io?token=' + process.env.BROWSERLESS_API_KEY,
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`https://www.capcut.com/template?search=${encodeURIComponent(TEMPLATE)}`);
    await page.waitForTimeout(5000);

    const templateLink = await page.locator('a[href*="template-detail"]').first();
    await templateLink.click();
    await page.waitForTimeout(4000);

    await page.locator('button:has-text("Use template")').click();
    await page.waitForTimeout(5000);

    const files = await fs.readdir(inputFile);
    const firstVideo = files.find((f) => f.endsWith('.mp4') || f.endsWith('.mov'));
    if (!firstVideo) throw new Error('No video file found in raw folder.');

    const uploadInput = await page.locator('input[type="file"]').first();
    await uploadInput.setInputFiles(path.join(inputFile, firstVideo));
    await page.waitForTimeout(10000);

    await page.locator('button:has-text("Export")').click();
    await page.waitForTimeout(10000);

    await browser.close();

    const finalPath = path.join(outputFolder, firstVideo);

    if (bot) {
      await postThread({
        bot,
        message: `✅ CapCut rendering complete! Saved to: ${finalPath}`,
      });
    }

    return finalPath;
  } catch (err) {
    console.error('[processWithCapCut] CapCut error:', err);
    if (bot) {
      await postThread({
        bot,
        message: `❌ CapCut error: ${err.message || err}`,
      });
    }
    return inputFile; // fallback to raw if failed
  }
}