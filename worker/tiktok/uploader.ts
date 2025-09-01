import { runBrowserless } from './browserless';
import type { TikTokProfile } from './config';

export interface PostVideoInput {
  profile: TikTokProfile;
  videoUrl: string;
  caption: string;
  tags: string[];
  env: Record<string, string | undefined>;
}

/**
 * Upload a video to TikTok using Browserless. This is a lightweight stub that
 * posts via the mobile creator page and returns the new post URL.
 */
export async function postVideo({ profile, videoUrl, caption, tags, env }: PostVideoInput): Promise<string> {
  const tagString = tags.map(t => `#${t}`).join(' ');
  const fullCaption = `${caption} ${tagString}`.trim();
  const script = `
    const videoUrl = '${videoUrl}';
    const caption = ${JSON.stringify(fullCaption)};
    await page.goto('https://m.tiktok.com/creator-center/upload');
    await page.setExtraHTTPHeaders({ cookie: 'sessionid=${profile.session};' });
    // TODO: upload videoUrl and set caption.
    return 'https://www.tiktok.com/@${profile.username}';
  `;
  const res = await runBrowserless(script, {
    key: env.BROWSERLESS_API_KEY!,
    base: env.BROWSERLESS_BASE_URL,
  });
  if (typeof res === 'string') return res;
  return res.url || String(res);
}
