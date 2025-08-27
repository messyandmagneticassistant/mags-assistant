// 📬 Telegram webhook route handler
import { tgSend } from '../../lib/telegram';
import { dispatch } from '../../maggie/intent-router';

export async function handleTelegramWebhook(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const payload = await request.json();
    const message = payload?.message?.text?.trim();
    const from = payload?.message?.from;
    const username = from?.username || from?.first_name || 'Unknown';

    if (!message) {
      return new Response('No message received', { status: 400 });
    }

    await tgSend(`📩 Message from @${username}: ${message}`);
    const result = await dispatch(message, { source: 'telegram' });

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[handleTelegramWebhook] Error:', err);
    return new Response('Error parsing Telegram message', { status: 500 });
  }
}