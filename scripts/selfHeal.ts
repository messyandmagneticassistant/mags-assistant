import process from 'node:process';
import { sendTelegramMessage } from './lib/telegramClient';

interface SelfHealOptions {
  triggeredBy?: string;
  notify?: boolean;
}

export type HealStatus = 'ok' | 'recovered' | 'failed' | 'skipped';

export interface ServiceResult {
  service: string;
  status: HealStatus;
  message: string;
  attempts: number;
}

export interface SelfHealSummary {
  startedAt: string;
  finishedAt: string;
  triggeredBy?: string;
  results: ServiceResult[];
}

const WAIT_MS = 3000;

function nowISO() {
  return new Date().toISOString();
}

function trimUrl(url: string): string {
  return url.replace(/\/$/, '');
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function probe(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: text || res.statusText };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function healBrowserless(): Promise<ServiceResult> {
  const base = process.env.BROWSERLESS_BASE_URL || process.env.BROWSERLESS_API_URL || '';
  const apiKey = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN || '';

  if (!base) {
    const message = 'No Browserless base URL configured';
    console.warn('[self-heal] Browserless skipped:', message);
    return { service: 'browserless', status: 'skipped', message, attempts: 0 };
  }

  const target = `${trimUrl(base)}/health`;
  const headers: Record<string, string> = {};
  if (apiKey) headers['x-api-key'] = apiKey;

  let attempts = 0;
  let lastError = '';

  for (const delay of [0, WAIT_MS]) {
    attempts += 1;
    if (delay) {
      console.log(`[self-heal] Browserless retrying in ${delay}ms`);
      await wait(delay);
    }

    const result = await probe(target, { headers });
    if (result.ok) {
      const status = attempts === 1 ? 'ok' : 'recovered';
      const message = `HTTP ${result.status} at ${target}`;
      console.log('[self-heal] Browserless OK:', message);
      return { service: 'browserless', status, message, attempts };
    }

    lastError = result.error ? `${result.status}: ${result.error}` : `HTTP ${result.status}`;
    console.warn('[self-heal] Browserless probe failed:', lastError);
  }

  return {
    service: 'browserless',
    status: 'failed',
    message: lastError || 'Unknown Browserless failure',
    attempts,
  };
}

async function healPuppeteer(): Promise<ServiceResult> {
  const workerUrl = process.env.WORKER_URL || process.env.WORKER_BASE_URL;
  if (!workerUrl) {
    const message = 'WORKER_URL not configured';
    console.warn('[self-heal] Puppeteer skipped:', message);
    return { service: 'puppeteer', status: 'skipped', message, attempts: 0 };
  }

  const endpoint = `${trimUrl(workerUrl)}/api/browser/session`;
  let attempts = 0;
  let lastError = '';

  for (const delay of [0, WAIT_MS]) {
    attempts += 1;
    if (delay) {
      console.log(`[self-heal] Requesting new browser session after ${delay}ms pause`);
      await wait(delay);
    }

    const result = await probe(endpoint, { method: 'POST' });
    if (result.ok) {
      const status = attempts === 1 ? 'ok' : 'recovered';
      const message = `Session endpoint responded ${result.status}`;
      console.log('[self-heal] Puppeteer session refreshed');
      return { service: 'puppeteer', status, message, attempts };
    }

    lastError = result.error ? `${result.status}: ${result.error}` : `HTTP ${result.status}`;
    console.warn('[self-heal] Puppeteer session request failed:', lastError);
  }

  return {
    service: 'puppeteer',
    status: 'failed',
    message: lastError || 'Unable to refresh browser session',
    attempts,
  };
}

async function healTikTok(): Promise<ServiceResult> {
  const workerUrl = process.env.WORKER_URL || process.env.WORKER_BASE_URL;
  const handles = [
    process.env.TIKTOK_PROFILE_MAIN,
    process.env.TIKTOK_PROFILE_MAGGIE,
    process.env.TIKTOK_PROFILE_WILLOW,
    process.env.TIKTOK_PROFILE_MARS,
  ].filter((value, index, array): value is string => !!value && array.indexOf(value) === index);

  if (!workerUrl) {
    const message = 'WORKER_URL not configured';
    console.warn('[self-heal] TikTok skipped:', message);
    return { service: 'tiktok', status: 'skipped', message, attempts: 0 };
  }

  if (!handles.length) {
    const message = 'No TikTok profiles provided';
    console.warn('[self-heal] TikTok skipped:', message);
    return { service: 'tiktok', status: 'skipped', message, attempts: 0 };
  }

  const endpoint = `${trimUrl(workerUrl)}/tiktok/check`;
  const missing: string[] = [];

  for (const handle of handles) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle }),
    }).catch((err) => ({ ok: false, status: 0, error: err instanceof Error ? err.message : String(err) } as any));

    if (!res || (res instanceof Response && !res.ok)) {
      const error = res instanceof Response ? await res.text().catch(() => '') : res.error;
      console.warn(`[self-heal] TikTok check failed for ${handle}:`, error);
      missing.push(handle);
      continue;
    }

    if (res instanceof Response) {
      const payload = await res.json().catch(() => ({}));
      if (!payload?.ok) {
        missing.push(handle);
      }
    }
  }

  if (!missing.length) {
    const message = `Sessions healthy for ${handles.length} profile(s)`;
    console.log('[self-heal] TikTok sessions verified');
    return { service: 'tiktok', status: 'ok', message, attempts: handles.length };
  }

  const message = `Missing session cookies for: ${missing.join(', ')}`;
  console.warn('[self-heal] TikTok sessions missing:', message);
  return { service: 'tiktok', status: 'failed', message, attempts: handles.length };
}

function formatResultLine(result: ServiceResult): string {
  const symbol =
    result.status === 'ok'
      ? '✅'
      : result.status === 'recovered'
        ? '🟡'
        : result.status === 'skipped'
          ? '⚪️'
          : '❌';
  return `${symbol} <b>${result.service}</b> — ${result.message}`;
}

export async function selfHeal(options: SelfHealOptions = {}): Promise<SelfHealSummary> {
  const startedAt = nowISO();
  console.log(`[self-heal] Starting recovery sequence (triggered by ${options.triggeredBy || 'manual'})`);

  const results: ServiceResult[] = [];
  results.push(await healBrowserless());
  results.push(await healPuppeteer());
  results.push(await healTikTok());

  const finishedAt = nowISO();
  const summary: SelfHealSummary = { startedAt, finishedAt, triggeredBy: options.triggeredBy, results };

  const lines = results.map(formatResultLine).join('\n');
  const header = options.triggeredBy ? `🔧 <b>Self-heal triggered by ${options.triggeredBy}</b>` : '🔧 <b>Self-heal report</b>';
  const footer = `⏱️ <i>${startedAt} → ${finishedAt}</i>`;

  if (options.notify !== false) {
    await sendTelegramMessage(`${header}\n${lines}\n${footer}`).catch(() => undefined);
  }

  console.log('[self-heal] Completed recovery sequence:', JSON.stringify(summary, null, 2));
  return summary;
}

async function runCli() {
  const triggeredBy = process.env.GITHUB_WORKFLOW
    ? `workflow:${process.env.GITHUB_WORKFLOW}`
    : 'manual';
  try {
    await selfHeal({ triggeredBy });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[self-heal] Fatal error:', message);
    await sendTelegramMessage(`❌ <b>Self-heal crashed</b>\n<code>${message}</code>`).catch(() => undefined);
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(`file://${process.argv[1] ?? ''}`).href) {
  runCli();
}
