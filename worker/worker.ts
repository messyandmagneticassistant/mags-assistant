// worker/worker.ts — PUBLIC worker (serves your domain)

import { handleTelegramCommand } from '../src/telegram/handleCommand';
import { runMaggie } from '../maggie/index';

export interface Env {
  POSTQ: KVNamespace;
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

export default {
  // 🔁 Scheduled tick (optional but nice for background loop)
  async scheduled(_e: ScheduledController, _env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runMaggie({ force: false }));
    ctx.waitUntil(fetch(`${APPS_SCRIPT_EXEC}?cmd=pulse`).catch(() => {}));
  },

  // 🌐 Fetch handler
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response('ok', { headers: cors() });
    }

    // Basic landing
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response('🧠 Maggie is online — try /health', {
        headers: { 'content-type': 'text/plain', ...cors() },
      });
    }

    // Health check + KV test
    if (url.pathname === '/health') {
      const key = `health:${Date.now()}`;
      let kv = { write: false, read: false };
      try {
        await env.POSTQ.put(key, 'ok', { expirationTtl: 60 });
        kv = { write: true, read: (await env.POSTQ.get(key)) === 'ok' };
      } catch {}
      return new Response(
        JSON.stringify(
          {
            ok: kv.write && kv.read,
            service: 'maggie-worker',
            kv,
            bindings: {
              POSTQ: !!env.POSTQ,
              STRIPE_SECRET_KEY: !!env.STRIPE_SECRET_KEY,
              NOTION_API_KEY: !!env.NOTION_API_KEY,
              TELEGRAM_BOT_TOKEN: !!env.TELEGRAM_BOT_TOKEN,
            },
          },
          null,
          2
        ),
        { headers: { 'content-type': 'application/json', ...cors() } }
      );
    }

    // Proxy to Apps Script
    if (url.pathname.startsWith('/api/appscript')) {
      return proxyAppsScript(request, url);
    }

    // Telegram webhook
    if (request.method === 'POST' && url.pathname === '/telegram-webhook') {
      try {
        const text = await request.text();
        await handleTelegramCommand(text); // use your src/telegram/handleCommand
        return new Response('ok', { status: 200, headers: cors() });
      } catch (e) {
        console.error('[worker] Telegram error:', e);
        return new Response('Telegram error', { status: 500, headers: cors() });
      }
    }

    return new Response('Not found', { status: 404, headers: cors() });
  },
};