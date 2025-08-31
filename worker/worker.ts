// worker/worker.ts — PUBLIC worker (serves your domain; Cloudflare-safe)

/**
 * Keep heavy/Node-only logic in mags-runner/.
 * This public worker stays lean: health, Apps Script proxy, Telegram webhook, CORS.
 */

import { handleTelegramCommand } from '../src/telegram/handleCommand';

export interface Env {
  POSTQ: KVNamespace;

  // Optional secrets/bindings you may have set
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  NOTION_API_KEY?: string;
  NOTION_DB_ID?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  OPENAI_API_KEY?: string;
}

const APPS_SCRIPT_EXEC =
  'https://script.google.com/macros/s/AKfycbx4p2_JKlcnm7qgSohthqWqzEw5-Rtb4i5uf54opLEIbgrA2zCd1pMBT77ijZKpr55o/exec';

function cors(extra: Record<string, string> = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type,Authorization,Stripe-Signature,X-Requested-With',
    ...extra,
  };
}

/** Transparent proxy to your Apps Script Web App */
async function proxyAppsScript(request: Request, url: URL) {
  const target = new URL(APPS_SCRIPT_EXEC);
  target.search = url.search;

  const init: RequestInit = { method: request.method, headers: {} };
  const ct = request.headers.get('content-type');
  if (ct) (init.headers as any)['content-type'] = ct;

  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = await request.arrayBuffer();
  }

  const r = await fetch(target.toString(), init);
  const body = await r.arrayBuffer();
  const h = new Headers(r.headers);
  Object.entries(cors()).forEach(([k, v]) => h.set(k, v));
  return new Response(body, { status: r.status, headers: h });
}

/** Minimal Telegram webhook: adapts your src/telegram/handleCommand(text) */
async function handleTelegramWebhook(request: Request): Promise<Response> {
  try {
    // Telegram sends JSON updates; prefer JSON but fall back to raw text just in case
    let text: string | undefined;
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const update = (await request.json()) as any;
      const msg = update?.message ?? update?.edited_message;
      text = msg?.text?.trim();
    } else {
      text = (await request.text()).trim();
    }

    if (!text) {
      return new Response('ok', { headers: cors() }); // nothing to do
    }

    await handleTelegramCommand(text);
    return new Response('ok', { headers: cors() });
  } catch (e) {
    console.error('[worker] Telegram webhook error:', e);
    return new Response('Telegram error', { status: 500, headers: cors() });
  }
}

export default {
  // Light cron (optional): ping Apps Script to keep flows warm
  async scheduled(_e: ScheduledController, _env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(fetch(`${APPS_SCRIPT_EXEC}?cmd=pulse`).catch(() => {}));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors() });

    // Root
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response('🧠 Maggie is online — try /health', {
        headers: { 'content-type': 'text/plain', ...cors() },
      });
    }

    // Health (KV read/write + bindings snapshot)
    if (url.pathname === '/health') {
      const key = `health:${Date.now()}`;
      let write = false, read = false;
      try {
        await env.POSTQ.put(key, 'ok', { expirationTtl: 60 });
        write = true;
        read = (await env.POSTQ.get(key)) === 'ok';
      } catch {}
      const payload = {
        ok: write && read,
        service: 'maggie-public-worker',
        kv: { write, read },
        bindings: {
          POSTQ: !!env.POSTQ,
          STRIPE_SECRET_KEY: !!env.STRIPE_SECRET_KEY,
          NOTION_API_KEY: !!env.NOTION_API_KEY,
          TELEGRAM_BOT_TOKEN: !!env.TELEGRAM_BOT_TOKEN,
          TELEGRAM_CHAT_ID: !!env.TELEGRAM_CHAT_ID,
          OPENAI_API_KEY: !!env.OPENAI_API_KEY
        },
        ts: new Date().toISOString()
      };
      return new Response(JSON.stringify(payload, null, 2), {
        headers: { 'content-type': 'application/json', ...cors() },
      });
    }

    // Apps Script proxy
    if (url.pathname.startsWith('/api/appscript')) {
      return proxyAppsScript(request, url);
    }

    // Telegram webhook endpoint
    if (request.method === 'POST' && url.pathname === '/telegram-webhook') {
      return handleTelegramWebhook(request);
    }

    return new Response('Not found', { status: 404, headers: cors() });
  },
};