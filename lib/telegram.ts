// lib/telegram.ts

import { getConfig } from '../utils/config';

/**
 * Sends a message via Telegram bot to the given chat ID (or default if not provided).
 * 
 * @param text - The message to send.
 * @param customChatId - Optional override for the recipient chat ID.
 * @returns Telegram API response.
 */
export async function tgSend(text: string, customChatId?: string) {
  const { botToken, chatId: defaultChatId } = await getConfig('telegram');
  const chatId = customChatId || defaultChatId;

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

// Alias for semantic clarity
export const sendTelegramMessage = tgSend;

/**
 * Convenience helper for Maggie task completion pings.
 */
export async function sendCompletionPing(taskName: string): Promise<void> {
  const label = taskName?.trim() || 'Task';
  await tgSend(`✅ Task finished: ${label} — you can test it now.`);
}