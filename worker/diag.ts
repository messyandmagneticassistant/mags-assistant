import { presenceReport, Env } from './lib/env';

const REQUIRED_KEYS = [
  'STRIPE_API_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TIKTOK_SESSION_MAIN',
  'TIKTOK_SESSION_WILLOW',
  'TIKTOK_SESSION_MAGGIE',
  'TIKTOK_PROFILE_MAIN',
  'TALLY_FORM_ID',
  'NOTION_API_KEY',
  'TELEGRAM_TOKEN',
  'BROWSERLESS_API_KEY',
];

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function parseConfig(doc: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(doc);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (err) {
    console.warn('[/diag/config] failed to parse config JSON:', err);
  }

  return null;
}

function hasRequiredKey(state: Record<string, unknown>, key: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(state, key)) {
    return false;
  }

  const value = state[key];
  return !(value === undefined || value === null || value === '');
}

export async function handleDiagConfig(env: Env): Promise<Response> {
  try {
    const report = presenceReport(env);
    const { ok: _presenceOk, ...reportDetails } = report;

    if (!env.PostQ || typeof env.PostQ.get !== 'function') {
      return jsonResponse(
        {
          ok: false,
          status: '❌ PostQ KV namespace is not configured.',
          ...reportDetails,
        },
        500,
      );
    }

    const secretBlobKey = env.SECRET_BLOB || 'thread-state';
    const rawValue = await env.PostQ.get(secretBlobKey);

    let state: Record<string, unknown> | null = null;
    let bytes: number | null = null;

    if (typeof rawValue === 'string') {
      bytes = new TextEncoder().encode(rawValue).length;
      if (rawValue.trim()) {
        state = parseConfig(rawValue);
      }
    } else if (rawValue && typeof rawValue === 'object') {
      state = rawValue as Record<string, unknown>;
      try {
        bytes = new TextEncoder().encode(JSON.stringify(rawValue)).length;
      } catch {
        bytes = null;
      }
    }

    const basePayload = {
      ...reportDetails,
      kv: {
        probed: true,
        secretBlobKey,
        hasDocument: !!state,
        bytes,
      },
    };

    if (!state) {
      return jsonResponse(
        {
          ok: false,
          status: `❌ Unable to load PostQ:${secretBlobKey} configuration.`,
          ...basePayload,
        },
        500,
      );
    }

    const missing = REQUIRED_KEYS.filter((key) => !hasRequiredKey(state!, key));

    if (missing.length > 0) {
      return jsonResponse(
        {
          ok: false,
          status: '❌ Missing keys',
          missing,
          ...basePayload,
        },
      );
    }

    return jsonResponse({
      ok: true,
      status: '✅ All required config keys are present and valid.',
      ...basePayload,
    });
  } catch (err: any) {
    console.error('[/diag/config] crash:', err?.stack || err);
    return jsonResponse({ ok: false, status: '❌ diag-failed' }, 500);
  }
}
