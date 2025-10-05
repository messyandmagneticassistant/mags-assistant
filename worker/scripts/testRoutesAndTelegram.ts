const ROUTES = [
  {
    url: 'https://maggie.messyandmagnetic.com/ping',
    expectOk: true,
  },
  {
    url: 'https://maggie.messyandmagnetic.com/summary',
    expectOk: true,
  },
] as const;

const TIMEOUT_MS = 15_000;

interface RouteConfig {
  url: string;
  expectOk: boolean;
}

interface RouteResult extends RouteConfig {
  status: number;
  durationMs: number;
  snippet: string;
  error?: string;
  ok: boolean;
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

async function testRoute(route: RouteConfig): Promise<RouteResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();

  try {
    const response = await fetch(route.url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
    });

    const durationMs = Date.now() - started;
    const status = response.status;
    let ok = response.ok;
    let snippet = '';
    let error: string | undefined;

    if (route.expectOk) {
      try {
        const data = (await response.json()) as { ok?: unknown };
        snippet = JSON.stringify(data).slice(0, 160);
        if (data?.ok !== true) {
          ok = false;
          error = 'failed-to-return-ok:true';
        }
      } catch (parseError) {
        ok = false;
        const detail = parseError instanceof Error ? parseError.message : String(parseError);
        error = `invalid-json: ${detail}`;
        try {
          const text = await response.text();
          snippet = text.replace(/\s+/g, ' ').trim().slice(0, 160);
        } catch {
          // ignore secondary failure
        }
      }
    }

    if (!snippet) {
      const text = await response.text();
      snippet = text.replace(/\s+/g, ' ').trim().slice(0, 160);
    }

    if (!ok && !error) {
      error = `status-${status}`;
    }

    return {
      ...route,
      ok,
      status,
      durationMs,
      snippet,
      error,
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ...route,
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

function formatFailureSummary(results: RouteResult[]): string {
  return results
    .filter((result) => !result.ok)
    .map((result) => {
      const route = new URL(result.url);
      const status = result.status ? `status: ${result.status}` : 'status: error';
      const detail = result.error ? `detail: ${result.error}` : undefined;
      return [`Route: ${route.pathname}`, status, detail].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

async function notifyResults(results: RouteResult[]): Promise<void> {
  const ok = results.every((result) => result.ok);
  const sha = process.env.GITHUB_SHA?.slice(0, 7) ?? 'local';
  const timestamp = new Date().toISOString();
  const failureSummary = ok ? '' : `\n${formatFailureSummary(results)}`;
  const text = ok
    ? `✅ Route test passed — /ping & /summary healthy. v:${sha} at ${timestamp}`
    : `❌ Route check failed for Maggie${failureSummary}\nSHA: ${sha}\nAt: ${timestamp}`;

  const result = await sendTelegramMessage(text);
  if (!result.ok) {
    console.warn('[route-test] Telegram notification was not sent:', result.error ?? 'unknown-error');
  }
}

async function main(): Promise<void> {
  console.log('[route-test] Checking routes:', ROUTES.map((route) => route.url).join(', '));
  const results = await Promise.all(ROUTES.map((route) => testRoute(route)));
  for (const result of results) {
    console.log(formatResult(result));
    if (result.snippet) {
      console.log(`    snippet: ${result.snippet}`);
    }
    if (result.error && !result.ok) {
      console.error(`    error: ${result.error}`);
    }
  }

  await notifyResults(results);

  if (!results.every((result) => result.ok)) {
    throw new Error('Route test failed');
  }
}

async function notifyUnexpectedFailure(error: unknown): Promise<void> {
  const sha = process.env.GITHUB_SHA?.slice(0, 7) ?? 'local';
  const timestamp = new Date().toISOString();
  const detail = error instanceof Error ? error.message : String(error);
  const text = `❌ Route check failed for Maggie\nError: ${detail}\nSHA: ${sha}\nAt: ${timestamp}`;
  const result = await sendTelegramMessage(text);
  if (!result.ok) {
    console.warn('[route-test] Telegram notification was not sent:', result.error ?? 'unknown-error');
  }
}

main().catch(async (error) => {
  console.error('[route-test] Unexpected error:', error instanceof Error ? error.message : error);
  try {
    await notifyUnexpectedFailure(error);
  } catch (notifyError) {
    console.error('[route-test] Failed to send failure notification:', notifyError);
  }
  process.exit(1);
});
