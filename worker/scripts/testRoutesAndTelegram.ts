const ROUTES = [
  'https://maggie.messyandmagnetic.com/',
  'https://assistant.messyandmagnetic.com/',
] as const;

const TIMEOUT_MS = 15_000;

interface RouteResult {
  url: string;
  ok: boolean;
  status: number;
  durationMs: number;
  snippet: string;
  error?: string;
}

type Ok = { ok?: boolean; error?: string };

type TelegramResponse = Ok & { result?: unknown };

function getTelegramCredentials(): { token?: string; chatId?: string } {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || undefined;
  const chatId = process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_TO || undefined;
  return { token, chatId };
}

async function sendTelegramMessage(text: string): Promise<Ok> {
  const { token, chatId } = getTelegramCredentials();

  if (!token || !chatId) {
    console.warn('[route-test] Skipping Telegram notification (missing credentials).');
    return { ok: false, error: 'missing-credentials' };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown' as const,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    let data: TelegramResponse | undefined;
    try {
      data = (await response.json()) as TelegramResponse;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn('[route-test] Failed to parse Telegram response JSON:', detail);
    }

    if (!response.ok || (data && data.ok === false)) {
      const detail = data?.error ?? `status-${response.status}`;
      console.error('[route-test] Telegram send failed:', detail);
      return { ok: false, error: detail };
    }

    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[route-test] Telegram network error:', detail);
    return { ok: false, error: detail };
  }
}

async function testRoute(url: string): Promise<RouteResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
    });

    const durationMs = Date.now() - started;
    const status = response.status;
    const text = await response.text();
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 160);
    const ok = response.ok;

    return {
      url,
      ok,
      status,
      durationMs,
      snippet,
      error: ok ? undefined : `status-${status}`,
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const detail = error instanceof Error ? error.message : String(error);
    return {
      url,
      ok: false,
      status: 0,
      durationMs,
      snippet: '',
      error: detail,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function formatResult(result: RouteResult): string {
  const statusText = result.status ? String(result.status) : 'error';
  const base = `${result.ok ? '✅' : '❌'} ${result.url} → ${statusText} in ${result.durationMs}ms`;
  if (!result.ok && result.error) {
    return `${base} (${result.error})`;
  }
  return base;
}

async function notify(ok: boolean): Promise<void> {
  const sha = process.env.GITHUB_SHA?.slice(0, 7) ?? 'local';
  const timestamp = new Date().toISOString();
  const text = ok
    ? `✅ Route test passed — maggie & assistant are live. v:${sha} at ${timestamp}`
    : `❌ Route test FAILED — see CI logs. v:${sha} at ${timestamp}`;

  const result = await sendTelegramMessage(text);
  if (!result.ok) {
    console.warn('[route-test] Telegram notification was not sent:', result.error ?? 'unknown-error');
  }
}

async function main(): Promise<void> {
  console.log('[route-test] Checking routes:', ROUTES.join(', '));
  const results = await Promise.all(ROUTES.map((url) => testRoute(url)));
  for (const result of results) {
    console.log(formatResult(result));
    if (result.snippet) {
      console.log(`    snippet: ${result.snippet}`);
    }
    if (result.error && !result.ok) {
      console.error(`    error: ${result.error}`);
    }
  }

  const allOk = results.every((result) => result.ok);
  await notify(allOk);

  if (!allOk) {
    throw new Error('Route test failed');
  }
}

main().catch(async (error) => {
  console.error('[route-test] Unexpected error:', error instanceof Error ? error.message : error);
  try {
    await notify(false);
  } catch (notifyError) {
    console.error('[route-test] Failed to send failure notification:', notifyError);
  }
  process.exit(1);
});
