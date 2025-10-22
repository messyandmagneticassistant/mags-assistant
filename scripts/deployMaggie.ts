import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { Client as NotionClient } from '@notionhq/client';

import saveToKV from '../lib/kv';
import { sendTelegramMessage } from './lib/telegramClient';
import { getConfig } from '../utils/config';

const execAsync = promisify(exec);
const DEPLOY_COMMAND = process.env.MAGGIE_WRANGLER_COMMAND || 'npx wrangler deploy';
const MAX_ATTEMPTS = Math.max(1, Number.parseInt(process.env.MAGGIE_DEPLOY_RETRIES || '2', 10));
const FALLBACK_TOKEN = (process.env.MAGGIE_WRANGLER_FALLBACK_TOKEN || '').trim();
const TELEGRAM_LOG_LIMIT = 3500;

interface DeployHistoryEntry {
  success: boolean;
  source: string;
  attempt: number;
  time: string;
  durationMs: number;
  command: string;
  logs: string;
}

interface NotionContext {
  client: NotionClient;
  databaseId: string;
}

let cachedNotion: NotionContext | null | undefined;

function ensureWranglerConfigExists(): boolean {
  const wranglerPath = path.resolve(process.cwd(), 'wrangler.toml');
  return existsSync(wranglerPath);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function trimLog(log: string, limit = TELEGRAM_LOG_LIMIT): string {
  const normalized = log.trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `…${normalized.slice(normalized.length - limit)}`;
}

async function safeTelegramSend(message: string): Promise<void> {
  try {
    const result = await sendTelegramMessage(message);
    if (!result?.ok) {
      console.warn('[deployMaggie] Telegram send failed', result);
    }
  } catch (err) {
    console.warn('[deployMaggie] Telegram send threw', err);
  }
}

async function ensureNotionContext(): Promise<NotionContext | null> {
  if (cachedNotion !== undefined) {
    return cachedNotion ?? null;
  }

  const token =
    process.env.NOTION_MAGGIE_DEPLOY_TOKEN ||
    process.env.NOTION_TOKEN ||
    process.env.NOTION_API_TOKEN ||
    process.env.NOTION_MAGGIE_TOKEN;
  const databaseId =
    process.env.NOTION_MAGGIE_DEPLOY_DB ||
    process.env.NOTION_MAGGIE_EVENTS_DB ||
    process.env.NOTION_DB_ID;

  if (!token || !databaseId) {
    cachedNotion = null;
    return null;
  }

  try {
    const client = new NotionClient({ auth: token });
    cachedNotion = { client, databaseId };
    return cachedNotion;
  } catch (err) {
    console.warn('[deployMaggie] Failed to initialize Notion client', err);
    cachedNotion = null;
    return null;
  }
}

async function logDeployToNotion(entry: DeployHistoryEntry): Promise<void> {
  const context = await ensureNotionContext();
  if (!context) return;

  const { client, databaseId } = context;
  const title = `Deploy • ${entry.success ? '✅' : '❌'} • ${new Date(entry.time).toLocaleString()}`;
  const message = `Source: ${entry.source}\nAttempt: ${entry.attempt}\nDuration: ${(entry.durationMs / 1000).toFixed(1)}s`;
  const detail = entry.logs.slice(0, 1800);

  try {
    await client.pages.create({
      parent: { database_id: databaseId },
      properties: {
        Name: { title: [{ text: { content: title } }] },
        Action: { select: { name: 'deploy' } },
        Trigger: { select: { name: entry.source } },
        Status: { select: { name: entry.success ? 'Success' : 'Failure' } },
        Timestamp: { date: { start: entry.time } },
        Message: {
          rich_text: [
            {
              text: { content: `${message}\n\n${detail}` },
            },
          ],
        },
      },
    });
  } catch (err) {
    console.warn('[deployMaggie] Failed to log deploy to Notion', err);
  }
}

async function recordDeployHistory(entry: DeployHistoryEntry): Promise<void> {
  try {
    await saveToKV('maggie:deploy:latest', entry);
  } catch (err) {
    console.warn('[deployMaggie] Failed to update latest deploy KV entry', err);
  }

  const historyKey = `maggie:deploy:${entry.time}`;
  try {
    await saveToKV(historyKey, entry);
  } catch (err) {
    console.warn('[deployMaggie] Failed to append deploy history KV entry', err);
  }
}

async function resolveCloudflareToken(): Promise<string | null> {
  const directEnv = [
    process.env.CLOUDFLARE_API_TOKEN,
    process.env.CLOUDFLARE_TOKEN,
    process.env.CF_API_TOKEN,
    process.env.API_TOKEN,
  ];

  for (const candidate of directEnv) {
    if (candidate && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  try {
    const cloudflareConfig = (await getConfig('cloudflare')) ?? {};
    const possible =
      cloudflareConfig.apiToken ||
      cloudflareConfig.cloudflareApiToken ||
      cloudflareConfig.token ||
      cloudflareConfig.cloudflareToken ||
      cloudflareConfig.workerToken ||
      cloudflareConfig.postqToken ||
      cloudflareConfig.kvToken;
    if (typeof possible === 'string' && possible.trim().length > 0) {
      return possible.trim();
    }
  } catch (err) {
    console.warn('[deployMaggie] Failed to load Cloudflare token from config', err);
  }

  try {
    const snapshot = await getConfig();
    const fallbacks =
      (snapshot && typeof snapshot === 'object' ? (snapshot as Record<string, any>) : null) ?? {};
    const candidates = [
      fallbacks.CLOUDFLARE_TOKEN,
      fallbacks.cloudflareToken,
      fallbacks.tokens?.cloudflare,
      fallbacks.PostQ?.token,
      fallbacks.PostQ?.cloudflareToken,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  } catch (err) {
    console.warn('[deployMaggie] Unable to load global config for Cloudflare token', err);
  }

  if (FALLBACK_TOKEN) {
    return FALLBACK_TOKEN;
  }

  return null;
}

function buildTelegramLog(logs: string): string {
  const sanitized = escapeHtml(trimLog(logs));
  return `<pre>${sanitized}</pre>`;
}

function collectLogs(stdout?: string | null, stderr?: string | null): string {
  const parts = [stdout, stderr].filter((part): part is string => !!part && part.trim().length > 0);
  return parts.join('\n\n').trim();
}

export async function deployMaggie(triggerSource = 'auto'): Promise<DeployHistoryEntry | null> {
  const token = await resolveCloudflareToken();

  if (!token) {
    await safeTelegramSend('❌ Missing Cloudflare API token. Cannot deploy Maggie.');
    return null;
  }

  if (!ensureWranglerConfigExists()) {
    await safeTelegramSend('❌ `wrangler.toml` is missing. Cannot deploy Maggie.');
    return null;
  }

  const startTimestamp = new Date();
  let combinedLogs = '';
  let success = false;
  let attempt = 0;

  for (let currentAttempt = 1; currentAttempt <= MAX_ATTEMPTS; currentAttempt++) {
    attempt = currentAttempt;
    const start = Date.now();
    try {
      const { stdout, stderr } = await execAsync(DEPLOY_COMMAND, {
        env: { ...process.env, CLOUDFLARE_API_TOKEN: token },
        maxBuffer: 1024 * 1024 * 10,
      });

      combinedLogs = collectLogs(stdout, stderr);
      if (stderr && /error/i.test(stderr)) {
        throw new Error(stderr);
      }

      success = true;
      const duration = Date.now() - start;
      const message = `✅ Maggie deployed [${triggerSource}, attempt ${attempt}] in ${(duration / 1000).toFixed(1)}s.`;
      await safeTelegramSend(`${message}\n${buildTelegramLog(combinedLogs || stdout || '(no output)')}`);
      break;
    } catch (err) {
      const error = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      const stdout = typeof error.stdout === 'string' ? error.stdout : '';
      const stderr = typeof error.stderr === 'string' ? error.stderr : '';
      combinedLogs = collectLogs(stdout, stderr) || error.message || String(err);
      const prefix = `⚠️ Deploy attempt ${attempt} failed`;
      await safeTelegramSend(`${prefix}\n${buildTelegramLog(combinedLogs)}`);
    }
  }

  const endTimestamp = new Date();
  const durationMs = endTimestamp.getTime() - startTimestamp.getTime();

  const entry: DeployHistoryEntry = {
    success,
    source: triggerSource,
    attempt,
    time: startTimestamp.toISOString(),
    durationMs,
    command: DEPLOY_COMMAND,
    logs: combinedLogs || '(no output)',
  };

  await recordDeployHistory(entry);
  await logDeployToNotion(entry);

  if (!success) {
    await safeTelegramSend('❌ Maggie deploy failed after all attempts.');
  }

  return entry;
}

export const cron = {
  schedule: '0 6 * * *',
  run: async () => {
    await deployMaggie('cron');
  },
};

export const commands = {
  '/deploy': async () => {
    await safeTelegramSend('🚀 Manual deploy triggered...');
    await deployMaggie('manual');
  },
};

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (invokedFile === currentFile) {
  const source = process.argv[2] || 'manual';
  deployMaggie(source).catch((err) => {
    console.error('[deployMaggie] CLI execution failed', err);
    process.exitCode = 1;
  });
}
