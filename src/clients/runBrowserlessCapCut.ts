import { launch } from 'puppeteer-core';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

import { getBrowserlessOptions } from '../utils/browserless';
import { withPuppeteerSelfHeal } from '../../lib/selfHealing';

const DEFAULT_TEMPLATE_URL = 'https://www.capcut.com/tools/video-editor';
const DEFAULT_OUTDIR = 'uploads/maggie/exported';

export async function runBrowserlessCapCut(rawPath: string, outDir = DEFAULT_OUTDIR): Promise<string> {
  const outcome = await withPuppeteerSelfHeal(
    async () => {
      const browser = await launch(getBrowserlessOptions());
      try {
        const page = await browser.newPage();
        await page.goto(DEFAULT_TEMPLATE_URL);

        await page.waitForSelector('input[type="file"]');
        const input = await page.$('input[type="file"]');
        if (!input) throw new Error('Upload input not found on CapCut.');
        await input.uploadFile(rawPath);

        await page.waitForTimeout(5000);

        const exportBtn = await page.locator('button:has-text("Export")').first();
        await exportBtn.click();

        const downloadBtn = await page.locator('a:has-text("Download")').first();
        await page.waitForTimeout(5000);

        const href = await downloadBtn.getAttribute('href');
        if (!href || !href.startsWith('http')) throw new Error('No download link found.');

        const filename = `capcut-${Date.now()}.mp4`;
        const outPath = path.join(outDir, filename);
        const response = await axios.get(href, { responseType: 'arraybuffer' });
        await fs.mkdir(outDir, { recursive: true });
        await fs.writeFile(outPath, response.data);

        console.log(`[CapCut] Downloaded video to ${outPath}`);
        return outPath;
      } finally {
        await browser.close();
      }
    },
    {
      moduleName: 'CapCut Browserless Download',
      fallbackTask: 'capcut-upload',
      payload: { rawPath, outDir },
    }
  );

  if (outcome.status === 'success' && outcome.result) {
    return outcome.result;
  }

  const fallbackPath = path.join(outDir, `capcut-download-fallback-${Date.now()}.json`);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    fallbackPath,
    JSON.stringify(
      {
        error: outcome.error,
        fallback: outcome.fallback,
      },
      null,
      2
    ),
    'utf8'
  );
  return fallbackPath;
}