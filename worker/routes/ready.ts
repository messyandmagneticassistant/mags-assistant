import type { Env } from '../worker';

function cors(extra: Record<string, string> = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type,Authorization,Stripe-Signature,X-Requested-With',
    ...extra,
  };
}

const ROUTES = [
  '/health',
  '/diag/config',
  '/tiktok/post',
  '/webhooks/stripe',
  '/webhooks/tally',
  '/cron/daily',
];

const BLOB_KEY = 'thread-state';

export async function ready(env: Env): Promise<Response> {
  let kv = false;
  try {
    const key = `ready:${Date.now()}`;
    await env.POSTQ.put(key, 'ok', { expirationTtl: 60 });
    kv = (await env.POSTQ.get(key)) === 'ok';
  } catch {}

  const secrets: Record<string, boolean> = {};
  try {
    const blob = (await env.POSTQ.get(BLOB_KEY, 'json')) as Record<string, any> | null;
    if (blob && typeof blob === 'object') {
      const names = [
        'OPENAI_API_KEY',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'NOTION_API_KEY',
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_CHAT_ID',
        'WORKER_CRON_KEY',
      ];
      for (const name of names) {
        secrets[name] = !!(blob[name] && String(blob[name]).trim());
      }
    }
  } catch {}

  return new Response(
    JSON.stringify({ kv, secrets, routes: ROUTES }, null, 2),
    { headers: { 'content-type': 'application/json', ...cors() } }
  );
}

