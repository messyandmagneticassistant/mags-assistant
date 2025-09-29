export type TelegramEnv = {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
};

export type TelegramSendResult = {
  ok: boolean;
  status: number;
  body: unknown;
  error?: string;
};

type TelegramOptions = {
  env?: TelegramEnv;
  token?: string;
  chatId?: string;
  fetchImpl?: typeof fetch;
};

function isOptions(value: TelegramEnv | TelegramOptions | undefined): value is TelegramOptions {
  return !!value && typeof value === 'object' && ('env' in value || 'token' in value || 'chatId' in value || 'fetchImpl' in value);
}

function resolveEnv(source?: TelegramEnv | TelegramOptions): TelegramOptions {
  if (!source) {
    const processEnv = typeof process !== 'undefined' ? (process.env as TelegramEnv | undefined) : undefined;
    return { env: processEnv };
  }

  if (isOptions(source)) {
    return source as TelegramOptions;
  }

  return { env: source };
}

function resolveCredentials(options: TelegramOptions): { token: string | null; chatId: string | null; fetchImpl: typeof fetch } {
  const env = options.env;
  const token = options.token ?? env?.TELEGRAM_BOT_TOKEN ?? env?.TELEGRAM_TOKEN ?? null;
  const chatId = options.chatId ?? env?.TELEGRAM_CHAT_ID ?? null;
  const fetchImpl = options.fetchImpl ?? fetch;
  return { token, chatId, fetchImpl };
}

async function parseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    try {
      return await response.text();
    } catch {
      return null;
    }
  }
}

export async function sendTelegram(
  message: string,
  options?: TelegramEnv | TelegramOptions
): Promise<TelegramSendResult> {
  const resolved = resolveEnv(options);
  const { token, chatId, fetchImpl } = resolveCredentials(resolved);

  if (!token || !chatId) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: 'Missing Telegram credentials',
    };
  }

  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });

    const body = await parseBody(response);
    const ok = !!(response.ok && typeof body === 'object' && body !== null && 'ok' in body ? (body as { ok?: boolean }).ok : response.ok);

    return {
      ok,
      status: response.status,
      body,
      error: ok ? undefined : typeof body === 'object' && body !== null && 'description' in body ? String((body as { description?: unknown }).description) : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: err instanceof Error ? err.message : 'Unknown Telegram error',
    };
  }
}
