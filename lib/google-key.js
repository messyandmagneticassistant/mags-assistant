import { env, requireEnv } from './env.js';

const cache = new Map();

export async function fetchGoogleKey(kind = 'mags') {
  const baseUrl = env.GOOGLE_KEY_URL
    ? env.GOOGLE_KEY_URL.replace(/\/mags-key$/, '')
    : null;
  const url = kind === 'mags'
    ? env.GOOGLE_KEY_URL
    : baseUrl
    ? `${baseUrl}/codex-key`
    : null;
  if (!url) throw new Error('Missing env: GOOGLE_KEY_URL');
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${requireEnv('FETCH_PASS')}`,
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch key: ${res.status}`);
  const text = (await res.text()).trim();
  if (!text) throw new Error('Empty key');
  cache.set(url, text);
  return text;
}
