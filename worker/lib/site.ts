import type { Env } from './env';

const SITE_PREFIX = 'site:';
const SITE_HOSTS = new Set([
  'messyandmagnetic.com',
  'www.messyandmagnetic.com',
  'assistant.messyandmagnetic.com',
]);

interface StoredSiteAsset {
  path: string;
  content: string;
  encoding?: 'base64' | 'text' | 'utf8';
  contentType?: string;
  hash?: string;
  size?: number;
  deployedAt?: string;
}

function decodeBase64(content: string): Uint8Array {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function buildResponse(
  asset: StoredSiteAsset,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers: Record<string, string> = {
    'cache-control': 'public, max-age=300, s-maxage=900',
    'content-type': asset.contentType || 'application/octet-stream',
    ...extraHeaders,
  };

  if (asset.hash) headers.etag = asset.hash;
  if (asset.deployedAt) headers['last-modified'] = asset.deployedAt;

  const encoding = asset.encoding || 'base64';
  if (encoding === 'base64') {
    const bytes = decodeBase64(asset.content);
    return new Response(bytes, { status, headers });
  }

  return new Response(asset.content, { status, headers });
}

function normalizePath(pathname: string): string[] {
  const raw = pathname.split('?')[0];
  let normalized = raw.replace(/^\/+/g, '');
  if (normalized === '') normalized = 'index.html';

  const candidates = new Set<string>();
  candidates.add(normalized);

  if (normalized.endsWith('/')) {
    candidates.add(`${normalized}index.html`);
  }

  if (!normalized.includes('.')) {
    candidates.add(`${normalized}.html`);
    candidates.add(`${normalized}/index.html`);
  }

  if (normalized !== 'index.html') {
    candidates.add('index.html');
  }

  return [...candidates];
}

async function readAsset(env: Env, relativePath: string): Promise<StoredSiteAsset | null> {
  const key = `${SITE_PREFIX}${relativePath}`;
  try {
    const record = await env.BRAIN.get<StoredSiteAsset>(key, { type: 'json' });
    if (!record) return null;
    return record;
  } catch (err) {
    console.warn('[site] Failed to read asset', relativePath, err);
    return null;
  }
}

export async function serveStaticSite(req: Request, env: Env): Promise<Response | null> {
  const host = req.headers.get('host')?.toLowerCase();
  if (!host || !SITE_HOSTS.has(host)) return null;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return null;
  }

  if (!env?.BRAIN || typeof env.BRAIN.get !== 'function') {
    console.warn('[site] BRAIN KV binding missing');
    return new Response('Service unavailable', { status: 503 });
  }

  const url = new URL(req.url);
  const reserved = /^(?:\/api\/|\/webhooks\/|\/tiktok\/|\/cron\/|\/tasks\/|\/donors\/|\/ai\/|\/admin\/|\/diag\/|\/orders\/|\/planner\/|\/blueprint\/|\/ready$|\/health$|\/compose$|\/schedule$)/;
  if (reserved.test(url.pathname)) {
    return null;
  }
  const candidates = normalizePath(url.pathname);

  for (const candidate of candidates) {
    const asset = await readAsset(env, candidate);
    if (asset) {
      const headers: Record<string, string> = {};
      if (candidate === 'index.html' && url.pathname !== '/' && !url.pathname.endsWith('index.html')) {
        headers['x-site-fallback'] = candidate;
      }
      const response = buildResponse(asset, 200, headers);
      if (req.method === 'HEAD') {
        return new Response(null, { status: response.status, headers: response.headers });
      }
      return response;
    }
  }

  return new Response('Not Found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
