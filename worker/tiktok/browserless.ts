const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1';

export interface BrowserlessOptions {
  key: string;
  base?: string;
}

/**
 * Run a small Playwright script on Browserless. The script is wrapped to ensure
 * a mobile user-agent. Returns parsed JSON result from Browserless or throws on
 * non-200 responses.
 */
export async function runBrowserless(script: string, opts: BrowserlessOptions): Promise<any> {
  const url = `${opts.base ?? 'https://chrome.browserless.io'}/playwright?token=${opts.key}`;
  const wrapped = `const { chromium } = require('playwright');\n` +
    `(async () => {\n` +
    `  const browser = await chromium.launch();\n` +
    `  const ctx = await browser.newContext({ userAgent: '${MOBILE_UA}' });\n` +
    `  const page = await ctx.newPage();\n` +
    `  const result = await (async () => {\n${script}\n    })();\n` +
    `  await browser.close();\n` +
    `  return result;\n})();`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ script: wrapped }),
  });
  if (!res.ok) throw new Error(`Browserless error ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const MOBILE_USER_AGENT = MOBILE_UA;
