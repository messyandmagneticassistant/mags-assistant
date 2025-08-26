// lib/telegram.ts

import { getConfig } from '../utils/config';

export async function tgSend(text: string) {
  const { botToken, chatId } = await getConfig('telegram');
  if (!botToken || !chatId) {
    console.warn('[tgSend] Missing Telegram credentials');
    return { ok: false, reason: 'MISSING_TELEGRAM_ENV' };
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[tgSend] Telegram error:', json);
    }

    return {
      ok: res.ok,
      status: res.status,
      resp: json,
    };
  } catch (err) {
    console.error('[tgSend] Network error:', err);
    return { ok: false, reason: 'FETCH_FAILED' };
  }
}

// Optional alias for semantic clarity
export const sendTelegramMessage = tgSend;