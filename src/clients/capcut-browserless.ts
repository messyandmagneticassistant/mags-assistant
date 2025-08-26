import { launch } from 'puppeteer-core';
import { getBrowserlessOptions } from '../utils/browserless';
import path from 'path';

export async function runBrowserlessCapCut(
  rawPath: string,
  outDir: string
): Promise<string> {
  const browser = await launch(getBrowserlessOptions());

  try {
    const page = await browser.newPage();
    await page.goto('https://www.capcut.com/tools/video-editor');

    // Simulate drag & drop upload
    await page.waitForSelector('input[type="file"]');
    const input = await page.$('input[type="file"]');
    if (input) await input.uploadFile(rawPath);

    await page.waitForTimeout(5000); // simulate processing

    // Final export path (stubbed)
    const filename = path.basename(rawPath).replace(/\.[^/.]+$/, '');
    const exported = path.join(outDir, `${filename}-capcut.mp4`);

    return exported;
  } finally {
    await browser.close();
  }
}