// mags-runner/worker.ts — CRON worker

import { handleTelegramWebhook } from '../src/handlers/telegram';
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

// 👇 Apps Script Web App URL
const APPS_SCRIPT_EXEC =
  'https://script.google.com/macros/s/AKfycbx4p2_JKlcnm7qgSohthqWqzEw5-Rtb4i5uf54opLEIbgrA2zCd1pMBT77ijZKpr55o/exec';

function cors(headers: Record<string, string> = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    ...headers,
  };
}

async function proxyAppsScript(request: Request, url: URL) {
  const target = new URL(APPS_SCRIPT_EXEC);
  target.search = url.search;

  const init: RequestInit = { method: request.method, headers: {} };
  const ct = request.headers.get('content-type');
  if (ct) (init.headers as any)['content-type'] = ct;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  const r = await fetch(target.toString(), init);
  const body = await r.arrayBuffer();
  const h = new Headers(r.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return new Response(body, { status: r.status, headers: h });
}

export default {
  // 🔁 Cron (Cloudflare → Triggers) e.g. every 10 min
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    console.log('⏰ mags-runner tick at', event.cron);
    // 1) run Maggie loop
    ctx.waitUntil(runMaggie({ force: false }));
    // 2) ping Apps Script (optional)
    ctx.waitUntil(fetch(`${APPS_SCRIPT_EXEC}?cmd=pulse`).catch(() => {}));
  },

  // 🌐 Optional HTTP (handy for workers.dev tests)
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response('ok', { headers: cors() });
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'mags-runner' }), {
        headers: { 'content-type': 'application/json', ...cors() },
      });
    }

    if (url.pathname.startsWith('/api/appscript')) {
      return proxyAppsScript(request, url);
    }

    if (request.method === 'POST' && url.pathname === '/telegram-webhook') {
      try {
        return await handleTelegramWebhook(request);
      } catch (err) {
        console.error('[runner] Telegram webhook error:', err);
        return new Response('Error handling Telegram webhook', { status: 500 });
      }
    }

    return new Response('mags-runner online', {
      headers: { 'Content-Type': 'text/plain', ...cors() },
    });
  },
};