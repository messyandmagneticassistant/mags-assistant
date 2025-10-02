import process from 'node:process';

import { sendTelegramMessage } from '../../scripts/lib/telegramClient';

const DEFAULT_DEPLOY_STATUS_URL = 'https://maggie.messyandmagnetic.com/ping';
const DEFAULT_DEBUG_URL = 'https://maggie.messyandmagnetic.com/ping-debug';

interface DeployStatusResponse {
  ok: boolean;
  error?: string | null;
  routes?: unknown;
  version?: unknown;
  timestamp?: unknown;
  host?: unknown;
  deployment?: {
    ok?: unknown;
    error?: unknown;
    routes?: unknown;
    version?: unknown;
    timestamp?: unknown;
    host?: unknown;
  };
}

interface ParsedDeployStatus {
  ok: boolean;
  error?: string;
  routes: string[];
  version?: string;
  timestamp?: string;
  host?: string;
}

interface FetchResult {
  ok: boolean;
  status: number;
  data?: ParsedDeployStatus;
  raw?: unknown;
  text?: string;
  error?: string;
}

function isDeployStatusResponse(value: unknown): value is DeployStatusResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== 'boolean') return false;
  const error = record.error;
  if (error !== undefined && error !== null && typeof error !== 'string') return false;
  if ('deployment' in record) {
    const deployment = (record.deployment ?? null) as unknown;
    if (deployment && typeof deployment === 'object') {
      const dep = deployment as Record<string, unknown>;
      const depOk = dep.ok;
      if (depOk !== undefined && typeof depOk !== 'boolean') return false;
      const depError = dep.error;
      if (depError !== undefined && depError !== null && typeof depError !== 'string') return false;
    } else if (deployment !== null) {
      return false;
    }
  }
  return true;
}

function extractString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function extractRoutes(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }
  if (typeof value === 'object') {
    const arr = Array.isArray((value as { routes?: unknown }).routes)
      ? ((value as { routes?: unknown }).routes as unknown[])
      : null;
    if (arr) {
      return arr.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    }
  }
  return [];
}

function normaliseDeployStatus(raw: DeployStatusResponse): ParsedDeployStatus {
  const nested = (raw.deployment ?? null) as DeployStatusResponse['deployment'] | null;
  const source = nested && typeof nested === 'object' ? nested : raw;
  const routes = [
    ...extractRoutes(raw.routes),
    ...extractRoutes(nested?.routes),
  ];

  const uniqueRoutes = Array.from(new Set(routes));

  return {
    ok: nested && typeof nested.ok === 'boolean' ? Boolean(nested.ok) : raw.ok,
    error: extractString(nested?.error) ?? extractString(raw.error),
    routes: uniqueRoutes,
    version: extractString(source?.version) ?? extractString(raw.version),
    timestamp: extractString(source?.timestamp) ?? extractString(raw.timestamp),
    host: extractString(source?.host) ?? extractString(raw.host),
  };
}

async function fetchDeployStatus(url: string): Promise<FetchResult> {
  try {
    const response = await fetch(url, {
      headers: {
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
    });
    const status = response.status;

    let text: string | undefined;
    let parsed: unknown;
    try {
      text = await response.text();
      parsed = text ? JSON.parse(text) : undefined;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, status, text, error: `invalid-json: ${detail}` };
    }

    if (!isDeployStatusResponse(parsed)) {
      console.error('[deploy-check] Unexpected payload shape', parsed);
      return { ok: false, status, raw: parsed, text, error: 'invalid-payload' };
    }

    const data = normaliseDeployStatus(parsed);
    const ok = response.ok && data.ok === true;
    return { ok, status, data, raw: parsed, text };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, error: detail };
  }
}

function getDeployStatusUrl(): { statusUrl: string; debugUrl: string } {
  const statusUrl = normalizeUrl(process.env.WORKER_PING_URL ?? process.env.DEPLOY_STATUS_URL, DEFAULT_DEPLOY_STATUS_URL);
  const debugUrl = normalizeUrl(process.env.WORKER_PING_DEBUG_URL, DEFAULT_DEBUG_URL);
  return { statusUrl, debugUrl: debugUrl ?? deriveDebugUrl(statusUrl) ?? DEFAULT_DEBUG_URL };
}

function normalizeUrl(candidate: string | undefined, fallback: string): string {
  if (!candidate) return fallback;
  try {
    return new URL(candidate).toString();
  } catch {
    return fallback;
  }
}

function deriveDebugUrl(ping: string): string | null {
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

function resolveTelegramChatId(): string | undefined {
  const explicit = process.env.TELEGRAM_DEPLOY_CHAT_ID || process.env.TELEGRAM_DEPLOYMENT_CHAT_ID;
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  const fallback = process.env.TELEGRAM_CHAT_ID;
  return fallback && fallback.trim().length > 0 ? fallback.trim() : undefined;
}

function formatSuccessMessage(result: FetchResult, url: string): string {
  const data = result.data;
  const routes = data?.routes.length ? data.routes.join(', ') : 'n/a';
  const lines = [
    '✅ Deployment confirmed — ping passed',
    `• URL: ${url}`,
    data?.host ? `• Host: ${data.host}` : null,
    data?.version ? `• Worker version: ${data.version}` : null,
    `• Routes: ${routes}`,
    data?.timestamp ? `• Timestamp: ${data.timestamp}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

function formatFailureMessage(result: FetchResult, url: string, debugUrl: string): string {
  const lines = [
    '❌ Deployment check failed',
    `• URL: ${url}`,
    `• Status: ${result.status || 'n/a'}`,
    result.error ? `• Error: ${result.error}` : null,
    result.data?.error ? `• Deployment error: ${result.data.error}` : null,
    result.data?.routes?.length ? `• Routes: ${result.data.routes.join(', ')}` : null,
    `• Debug URL: ${debugUrl}`,
    `• Timestamp: ${new Date().toISOString()}`,
  ].filter(Boolean);
  return lines.join('\n');
}

async function sendTelegramNotification(message: string): Promise<void> {
  const chatId = resolveTelegramChatId();
  const result = await sendTelegramMessage(message, chatId ? { chatId } : {});
  if (!result.ok) {
    console.error('[deploy-check] Failed to send Telegram message', result);
  }
}

async function main(): Promise<void> {
  const { statusUrl, debugUrl } = getDeployStatusUrl();
  const result = await fetchDeployStatus(statusUrl);

  if (result.ok) {
    const message = formatSuccessMessage(result, statusUrl);
    console.log('[deploy-check] Deployment OK');
    await sendTelegramNotification(message);
    return;
  }

  console.error('[deploy-check] Deployment check failed', result);
  const message = formatFailureMessage(result, statusUrl, debugUrl);
  await sendTelegramNotification(message);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error('[deploy-check] Unexpected error', error);
  const { statusUrl, debugUrl } = getDeployStatusUrl();
  const message =
    '❌ Deployment check crashed' +
    `\n• URL: ${statusUrl}` +
    `\n• Debug URL: ${debugUrl}` +
    `\n• Error: ${error instanceof Error ? error.message : String(error)}`;
  sendTelegramNotification(message).finally(() => {
    process.exitCode = 1;
  });
});
