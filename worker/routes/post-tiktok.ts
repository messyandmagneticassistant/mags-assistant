import type { Env as BaseEnv } from '../lib/env';
import type { TikTokPosterResult } from '../../lib/tiktok/poster';

const DEFAULT_PROFILE = 'main';
const DEFAULT_PROMPT = 'default-prompt';
const DEFAULT_VIDEO_URL = 'https://example.com/fallback-video.mp4';
const DEFAULT_CAPTION = "Here's a test post via Mags 🎥";

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

type Env = BaseEnv & {
  KV?: KVNamespace;
  PostQ?: KVNamespace;
  POSTQ?: KVNamespace;
  BROWSERLESS_API_KEY?: string;
  BROWSERLESS_TOKEN?: string;
  BROWSERLESS_BASE_URL?: string;
  BROWSERLESS_API_URL?: string;
  BROWSERLESS_URL?: string;
  BROWSERLESS_ENDPOINT?: string;
};

type HandlerResult = {
  ok: boolean;
  profile: string;
  prompt: string;
  videoURL: string;
  caption: string;
  sources: { video: string; caption: string };
  poster: TikTokPosterResult;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  });
}

function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function coerceString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function resolveKv(env: Env): KVNamespace | null {
  const candidates: Array<KVNamespace | undefined> = [env.KV, env.PostQ, env.POSTQ, env.BRAIN];
  for (const candidate of candidates) {
    if (candidate && typeof candidate.get === 'function') {
      return candidate;
    }
  }
  return null;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get('content-type');
  if (!type || !type.toLowerCase().includes('application/json')) return {};
  try {
    const data = await request.json();
    if (data && typeof data === 'object') return data as Record<string, unknown>;
  } catch {}
  return {};
}

async function readKvValue(kv: KVNamespace | null, key: string): Promise<string | null> {
  if (!kv) return null;
  try {
    const value = await kv.get(key);
    return typeof value === 'string' ? value : null;
  } catch (err) {
    console.warn('[post-tiktok] failed to read KV key', key, err);
    return null;
  }
}

export async function handle(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const queryProfile = coerceString(url.searchParams.get('profile'));
  const queryPrompt = coerceString(url.searchParams.get('prompt'));

  const body = await readJsonBody(request);

  const profile = coerceString(body.profile) ?? queryProfile ?? DEFAULT_PROFILE;
  const prompt = coerceString(body.prompt) ?? queryPrompt ?? DEFAULT_PROMPT;

  const kv = resolveKv(env);

  const requestVideo = coerceString(body.videoURL);
  const requestCaption = coerceString(body.caption);

  let videoSource = requestVideo ? 'request' : 'fallback';
  let captionSource = requestCaption ? 'request' : 'fallback';

  let videoURL = requestVideo ?? (await readKvValue(kv, `TikTok:next-video:${profile}`));
  if (videoURL) videoSource = requestVideo ? 'request' : 'kv';
  if (!videoURL) {
    videoURL = DEFAULT_VIDEO_URL;
    videoSource = 'fallback';
  }

  let caption = requestCaption ?? (await readKvValue(kv, `TikTok:next-caption:${profile}`));
  if (caption) captionSource = requestCaption ? 'request' : 'kv';
  if (!caption) {
    caption = DEFAULT_CAPTION;
    captionSource = 'fallback';
  }

  const browserlessKey =
    coerceString(body.browserlessKey) ??
    firstNonEmpty(
      env.BROWSERLESS_API_KEY,
      env.BROWSERLESS_TOKEN,
      (env as Record<string, unknown>).BROWSERLESS_KEY as string | undefined,
      (env as Record<string, unknown>).BROWSERLESS_SECRET as string | undefined
    );

  const browserlessBaseUrl =
    coerceString(body.browserlessBaseUrl) ??
    firstNonEmpty(env.BROWSERLESS_BASE_URL, env.BROWSERLESS_API_URL, env.BROWSERLESS_URL, env.BROWSERLESS_ENDPOINT);

  let poster: TikTokPosterResult;
  try {
    const { TikTokPoster } = await import('../../lib/tiktok/poster');
    poster = await TikTokPoster.post({
      profile,
      prompt,
      videoURL,
      caption,
      browserlessKey: browserlessKey ?? undefined,
      browserlessBaseUrl: browserlessBaseUrl ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[post-tiktok] failed to invoke TikTokPoster', message);
    poster = { success: false, error: 'poster-load-failed', message };
  }

  const response: HandlerResult = {
    ok: poster.success,
    profile,
    prompt,
    videoURL,
    caption,
    sources: { video: videoSource, caption: captionSource },
    poster,
  };

  const status = poster.success ? 200 : 500;
  return json(response, status);
}

export async function onRequestPost({ request, env, ctx }: { request: Request; env: Env; ctx: ExecutionContext }): Promise<Response> {
  return handle(request, env, ctx);
}

export function onRequestOptions(): Response {
  return optionsResponse();
}

export default {
  method: 'POST',
  path: '/post-tiktok',
  handler: handle,
};
