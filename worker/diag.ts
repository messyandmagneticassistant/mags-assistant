import { Env } from './lib/env';

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

export async function handleDiagConfig(env: Env): Promise<Response> {
  try {
    if (!env.PostQ || typeof env.PostQ.get !== 'function') {
      return jsonResponse({ status: '❌ PostQ KV namespace is not configured.' }, 500);
    }

    const state = (await env.PostQ.get('thread-state', { type: 'json' })) as
      | Record<string, unknown>
      | null;

    if (!state || typeof state !== 'object') {
      return jsonResponse({ status: '❌ Unable to load PostQ:thread-state configuration.' }, 500);
    }

    const missing = REQUIRED_KEYS.filter((key) => {
      const value = state[key];
      return value === undefined || value === null || value === '';
    });

    if (missing.length > 0) {
      return jsonResponse({ status: '❌ Missing keys', missing });
    }

    return jsonResponse({ status: '✅ All required config keys are present and valid.' });
  } catch (err: any) {
    console.error('[/diag/config] crash:', err?.stack || err);
    return jsonResponse({ status: '❌ diag-failed' }, 500);
  }
}
