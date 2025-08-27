// 📬 Telegram webhook route handler
import { tgSend } from '../../lib/telegram';
import { dispatch } from '../../maggie/intent-router';

export async function handleTelegramWebhook(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const payload = await request.json();
  const message = payload?.message?.text;
  const username = payload?.message?.from?.username || 'Unknown';

  if (!message) {
    return new Response("No message received", { status: 400 });
  }

  await tgSend(`📩 Message from @${username}: ${message}`);
  const result = await dispatch(message, { source: 'telegram' });

  return new Response(JSON.stringify({ ok: true, result }), {
    headers: { 'Content-Type': 'application/json' },
  });
}