import { launch } from 'puppeteer-core';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { getBrowserlessOptions } from '../utils/browserless';

const DEFAULT_TEMPLATE_URL = 'https://www.capcut.com/tools/video-editor';
const DEFAULT_OUTDIR = 'uploads/maggie/exported';

export async function runBrowserlessCapCut(rawPath: string, outDir = DEFAULT_OUTDIR): Promise<string> {
  const browser = await launch(getBrowserlessOptions());

  try {
    const page = await browser.newPage();
    await page.goto(DEFAULT_TEMPLATE_URL);

    // Upload file
    await page.waitForSelector('input[type="file"]');
    const input = await page.$('input[type="file"]');
    if (!input) throw new Error('Upload input not found on CapCut.');
    await input.uploadFile(rawPath);

    // Simulate editing wait
    await page.waitForTimeout(5000);

    // Export video
    const exportBtn = await page.locator('button:has-text("Export")').first();
    await exportBtn.click();

    // Wait for download button to appear
    const downloadBtn = await page.locator('a:has-text("Download")').first();
    await page.waitForTimeout(5000);

    const href = await downloadBtn.getAttribute('href');
    if (!href || !href.startsWith('http')) throw new Error('No download link found.');

    // Download video file
    const filename = `capcut-${Date.now()}.mp4`;
    const outPath = path.join(outDir, filename);
    const response = await axios.get(href, { responseType: 'arraybuffer' });
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(outPath, response.data);

    console.log(`[CapCut] Downloaded video to ${outPath}`);
    return outPath;
  } catch (err) {
    console.error('[CapCut] Error in runBrowserlessCapCut:', err);
    throw err;
  } finally {
    await browser.close();
  }
}