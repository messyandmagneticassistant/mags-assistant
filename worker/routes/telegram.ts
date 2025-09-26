import type { Env } from '../lib/env';
import { handleTelegramUpdate, type TelegramUpdate } from '../telegram';

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const update = (await request.json().catch(() => ({}))) as TelegramUpdate;
  const origin = new URL(request.url).origin;
  try {
    await handleTelegramUpdate(update, env, origin);
  } catch (err) {
    console.warn('[telegram] update handler failed', err);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
