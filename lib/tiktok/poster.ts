const DEFAULT_BROWSERLESS_BASE_URL = 'https://chrome.browserless.io';

export type TikTokPostPayload = {
  profile: string;
  videoURL: string;
  caption: string;
  prompt?: string;
  browserlessKey?: string;
  browserlessBaseUrl?: string | null;
};

export type TikTokPosterResult = {
  success: boolean;
  dryRun?: boolean;
  message?: string;
  status?: number;
  error?: string;
  details?: unknown;
  browserlessResponse?: unknown;
};

const BROWSERLESS_FUNCTION_CODE = `module.exports = async ({ context }) => {
  const { profile, videoURL, caption, prompt } = context || {};
  return {
    ok: true,
    profile,
    videoURL,
    caption,
    prompt,
    timestamp: new Date().toISOString(),
  };
};`;

function normalizeBaseUrl(input?: string | null): string {
  if (!input || typeof input !== 'string') {
    return DEFAULT_BROWSERLESS_BASE_URL;
  }

  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_BROWSERLESS_BASE_URL;

  try {
    const url = new URL(trimmed);
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/function';
    } else if (!url.pathname.endsWith('/function')) {
      url.pathname = `${url.pathname.replace(/\/$/, '')}/function`;
    }
    return url.toString();
  } catch {
    return trimmed.replace(/\/$/, '') + '/function';
  }
}

function buildBrowserlessUrl(baseUrl: string, token: string): string {
  try {
    const url = new URL(baseUrl);
    if (!url.searchParams.has('token')) {
      url.searchParams.set('token', token);
    }
    return url.toString();
  } catch {
    const normalized = baseUrl.replace(/\/$/, '');
    const separator = normalized.includes('?') ? '&' : '?';
    return `${normalized}${separator}token=${encodeURIComponent(token)}`;
  }
}

async function callBrowserless(
  url: string,
  payload: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: BROWSERLESS_FUNCTION_CODE, context: payload }),
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return { status: response.status, data };
}

export const TikTokPoster = {
  async post(options: TikTokPostPayload): Promise<TikTokPosterResult> {
    const { profile, videoURL, caption, prompt, browserlessKey, browserlessBaseUrl } = options;

    if (!videoURL) {
      return { success: false, error: 'missing-video-url', message: 'Video URL is required' };
    }

    const contextPayload: Record<string, unknown> = {
      profile,
      videoURL,
      caption,
      prompt: prompt ?? null,
    };

    if (!browserlessKey || !browserlessKey.trim()) {
      return {
        success: true,
        dryRun: true,
        message: 'Browserless key missing – simulated post',
        browserlessResponse: { context: contextPayload },
      };
    }

    const baseUrl = normalizeBaseUrl(browserlessBaseUrl);
    const targetUrl = buildBrowserlessUrl(baseUrl, browserlessKey.trim());

    try {
      const { status, data } = await callBrowserless(targetUrl, contextPayload);
      if (status >= 200 && status < 300) {
        return { success: true, status, browserlessResponse: data };
      }

      return {
        success: false,
        status,
        error: 'browserless-error',
        message: typeof data === 'string' ? data : 'Browserless returned an error',
        details: data,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: 'browserless-request-failed', message };
    }
  },
};

export default TikTokPoster;
