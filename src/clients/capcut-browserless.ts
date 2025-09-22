import { launch } from 'puppeteer-core';
import { promises as fs } from 'fs';
import path from 'path';

import { getBrowserlessOptions } from '../utils/browserless';
import { withPuppeteerSelfHeal } from '../../lib/selfHealing';

export async function runBrowserlessCapCut(
  rawPath: string,
  outDir: string
): Promise<string> {
  const outcome = await withPuppeteerSelfHeal(
    async () => {
      const browser = await launch(getBrowserlessOptions());
      try {
        const page = await browser.newPage();
        await page.goto('https://www.capcut.com/tools/video-editor');

        // Simulate drag & drop upload
        await page.waitForSelector('input[type="file"]');
        const input = await page.$('input[type="file"]');
        if (input) await input.uploadFile(rawPath);

        await page.waitForTimeout(5000); // simulate processing

        const filename = path.basename(rawPath).replace(/\.[^/.]+$/, '');
        const exported = path.join(outDir, `${filename}-capcut.mp4`);
        return exported;
      } finally {
        await browser.close();
      }
    },
    {
      moduleName: 'CapCut Browserless',
      fallbackTask: 'capcut-upload',
      payload: { rawPath, outDir },
    }
  );

  if (outcome.status === 'success' && outcome.result) {
    return outcome.result;
  }

  const fallbackPath = path.join(outDir, `capcut-fallback-${Date.now()}.json`);
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