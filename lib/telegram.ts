import { getConfig } from '../utils/config';

export async function tgSend(text: string) {
  const { botToken, chatId } = await getConfig('telegram');
  if (!botToken || !chatId) return { ok: false, reason: 'MISSING_TELEGRAM_ENV' };
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, resp: j };
}
