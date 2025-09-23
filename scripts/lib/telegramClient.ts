import process from 'node:process';

export interface TelegramMessageOptions {
  chatId?: string;
  parseMode?: 'HTML' | 'MarkdownV2' | 'Markdown' | undefined;
  disableLinkPreview?: boolean;
}

export interface TelegramResult {
  ok: boolean;
  status?: number;
  error?: string;
}

function getTelegramCredentials() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  return { token, chatId };
}

export async function sendTelegramMessage(
  text: string,
  options: TelegramMessageOptions = {},
): Promise<TelegramResult> {
  const { token, chatId: defaultChatId } = getTelegramCredentials();
  const chatId = options.chatId ?? defaultChatId;

  if (!token || !chatId) {
    console.warn('[telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return { ok: false, error: 'missing-credentials' };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: options.parseMode ?? 'HTML',
    disable_web_page_preview: options.disableLinkPreview ?? true,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('[telegram] Failed to send message:', response.status, detail);
      return { ok: false, status: response.status, error: detail || 'telegram-error' };
    }

    return { ok: true, status: response.status };
  } catch (err) {
    console.error('[telegram] Network error:', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
