import { runBrowserless } from './browserless';
import type { TikTokProfile } from './config';

interface BaseOpts {
  profile: TikTokProfile;
  targetUrl: string;
  env: Record<string, string | undefined>;
}

export async function like({ profile, targetUrl, env }: BaseOpts): Promise<void> {
  const script = `
    await page.goto('${targetUrl}');
    await page.setExtraHTTPHeaders({ cookie: 'sessionid=${profile.session};' });
    // TODO: click like button
  `;
  await runBrowserless(script, { key: env.BROWSERLESS_API_KEY!, base: env.BROWSERLESS_BASE_URL });
}

export async function comment({ profile, targetUrl, text, env }: BaseOpts & { text: string }): Promise<void> {
  const script = `
    await page.goto('${targetUrl}');
    await page.setExtraHTTPHeaders({ cookie: 'sessionid=${profile.session};' });
    // TODO: type comment
  `;
  await runBrowserless(script, { key: env.BROWSERLESS_API_KEY!, base: env.BROWSERLESS_BASE_URL });
}

export async function follow({ profile, targetUrl, env }: BaseOpts): Promise<void> {
  const script = `
    await page.goto('${targetUrl}');
    await page.setExtraHTTPHeaders({ cookie: 'sessionid=${profile.session};' });
    // TODO: follow user
  `;
  await runBrowserless(script, { key: env.BROWSERLESS_API_KEY!, base: env.BROWSERLESS_BASE_URL });
}
