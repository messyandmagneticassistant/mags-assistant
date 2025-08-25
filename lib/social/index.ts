import * as twitter from './providers/twitter.js';
import * as instagram from './providers/instagram.js';
import * as tiktok from './providers/tiktok.js';
import * as youtube from './providers/youtube.js';
import * as pinterest from './providers/pinterest.js';
import * as linkedin from './providers/linkedin.js';

export const providers: Record<string, { env: string; post: Function }> = {
  X: { env: 'TWITTER_API_KEY', post: twitter.post },
  Instagram: { env: 'INSTAGRAM_API_KEY', post: instagram.post },
  TikTok: { env: 'TIKTOK_ACCESS_TOKEN', post: tiktok.post },
  YouTube: { env: 'YOUTUBE_API_KEY', post: youtube.post },
  Pinterest: { env: 'PINTEREST_API_KEY', post: pinterest.post },
  LinkedIn: { env: 'LINKEDIN_API_KEY', post: linkedin.post },
};

export function getProvider(name: string) {
  return providers[name]?.post;
}

export function getConfiguredProviders() {
  const cfg: Record<string, boolean> = {};
  for (const [name, { env }] of Object.entries(providers)) {
    cfg[name] = !!process.env[env];
  }
  return cfg;
}
