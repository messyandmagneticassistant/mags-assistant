#!/usr/bin/env node
import process from 'node:process';

const DEFAULT_PING_URL = 'https://maggie.messyandmagnetic.com/ping';
const DEFAULT_DEBUG_URL = 'https://maggie.messyandmagnetic.com/ping-debug';

const pingUrl = normalizeUrl(process.env.WORKER_PING_URL, DEFAULT_PING_URL);
const debugUrl = normalizeUrl(process.env.WORKER_PING_DEBUG_URL, deriveDebugUrl(pingUrl) ?? DEFAULT_DEBUG_URL);
const maxAttempts = parseInteger(process.env.WORKER_PING_ATTEMPTS, 5);
const retryDelayMs = parseInteger(process.env.WORKER_PING_RETRY_MS, 5000);
const telegramToken = getEnvCandidate(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_TOKEN']);
const telegramChatId = getEnvCandidate([
  'TELEGRAM_CHAT_ID',
  'TELEGRAM_DEFAULT_CHAT_ID',
  'TELEGRAM_DEPLOY_CHAT_ID',
]);

async function main() {
  console.log('[verify-worker] starting deployment check');
  console.log('[verify-worker] endpoint:', pingUrl);
  let attempt = 0;
  let lastResult = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    lastResult = await runPingAttempt(pingUrl, attempt);
    if (lastResult.ok) {
      console.log(`[verify-worker] ping passed on attempt ${attempt}`);
      await sendTelegramSuccess(lastResult, attempt);
      return;
    }

    if (attempt < maxAttempts) {
      console.warn(
        `[verify-worker] ping attempt ${attempt} failed (status=${lastResult.status ?? 'n/a'}). Retrying in ${retryDelayMs}ms...`,
      );
      await delay(retryDelayMs);
    }
  }

  console.error('[verify-worker] ping failed after all attempts');
  const debugInfo = await fetchDebug(debugUrl);
  await sendTelegramFailure(lastResult, debugInfo);
  process.exitCode = 1;
}

function parseInteger(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeUrl(candidate, fallback) {
  if (!candidate) return fallback;
  try {
    return new URL(candidate).toString();
  } catch {
    return fallback;
  }
}

function deriveDebugUrl(ping) {
  try {
    const url = new URL(ping);
    if (url.pathname.endsWith('/ping')) {
      url.pathname = url.pathname.replace(/\/ping$/, '/ping-debug');
    } else {
      url.pathname = url.pathname.replace(/\/?$/, '/ping-debug');
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function runPingAttempt(url, attempt) {
  try {
    const response = await fetch(url, {
      headers: {
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
      },
    });
    const text = await response.text();
    const payload = safeJsonParse(text);
    const ok = Boolean(response.ok && payload && payload.ok === true);
    return {
      ok,
      status: response.status,
      payload,
      text,
      attempt,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      payload: null,
      text: null,
      error: error instanceof Error ? error.message : String(error),
      attempt,
    };
  }
}

function safeJsonParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDebug(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
      },
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text,
    };
  } catch (error) {
    return {
      status: null,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function sendTelegramSuccess(result, attempt) {
  if (!telegramToken || !telegramChatId) {
    console.log('[verify-worker] Telegram credentials missing; skipping success notification');
    return;
  }

  const payload = result?.payload ?? {};
  const version = payload.version ?? 'unknown';
  const timestamp = payload.timestamp ?? new Date().toISOString();
  const hostname = payload.hostname ?? new URL(pingUrl).hostname;
  const routes = Array.isArray(payload.routes) ? payload.routes.join(', ') : 'n/a';
  const commit = (process.env.GITHUB_SHA || '').slice(0, 7) || 'unknown';

  const message =
    `✅ Deployment confirmed — ping passed\n` +
    `• Host: ${hostname}\n` +
    `• Attempt: ${attempt}\n` +
    `• Worker version: ${version}\n` +
    `• Commit: ${commit}\n` +
    `• Routes: ${routes}\n` +
    `• Timestamp: ${timestamp}`;

  await sendTelegram(message);
}

async function sendTelegramFailure(result, debugInfo) {
  if (!telegramToken || !telegramChatId) {
    console.warn('[verify-worker] Telegram credentials missing; cannot send failure notification');
    return;
  }

  const status = result?.status ?? 'n/a';
  const payload = result?.payload;
  const error = result?.error ?? (payload ? JSON.stringify(payload) : 'no payload');
  const commit = (process.env.GITHUB_SHA || '').slice(0, 7) || 'unknown';

  const lines = [
    '⚠️ Deployment failed — ping did not return { ok: true }',
    `• Status: ${status}`,
    `• Commit: ${commit}`,
  ];

  if (error) {
    lines.push(`• Error: ${truncate(error, 160)}`);
  }

  if (payload && typeof payload === 'object') {
    lines.push(`• Payload: ${truncate(JSON.stringify(payload), 200)}`);
  }

  if (debugInfo) {
    const debugStatus = debugInfo.status ?? 'n/a';
    const debugBody = debugInfo.body || debugInfo.error;
    lines.push(`• Debug status: ${debugStatus}`);
    if (debugBody) {
      lines.push(`• Debug body: ${truncate(debugBody, 200)}`);
    }
  }

  await sendTelegram(lines.join('\n'));
}

function truncate(value, maxLength) {
  if (!value) return value;
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramChatId, text }),
    });
    if (!response.ok) {
      console.warn('[verify-worker] Telegram send failed', await response.text().catch(() => ''));
    }
  } catch (err) {
    console.warn('[verify-worker] Telegram send error', err);
  }
}

function getEnvCandidate(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

await main();
