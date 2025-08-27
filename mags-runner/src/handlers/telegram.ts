import { tgSend } from '../../lib/telegram';
import { dispatch } from '../../maggie/intent-router';

export async function handleTelegramWebhook(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const payload = await request.json();
  const message = payload?.message?.text;
  const chatId = payload?.message?.chat?.id;
  const username = payload?.message?.from?.username || 'Unknown';

  if (!message || !chatId) {
    return new Response('Invalid message format', { status: 400 });
  }

  // Dispatch to Maggie's core brain
  const result = await dispatch(message, { source: 'telegram', username });

  // If result is a string, reply directly
  const replyText =
    typeof result === 'string'
      ? result
      : result?.reply || '🧠 Message received and processed.';

  // Reply back in Telegram
  await tgSend(replyText, chatId);

  return new Response(JSON.stringify({ ok: true, result: replyText }), {
    headers: { 'Content-Type': 'application/json' },
  });
}