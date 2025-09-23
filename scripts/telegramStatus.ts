import http from 'node:http';
import process from 'node:process';

import { getConfigValue } from '../lib/kv';
import { sendTelegramMessage } from './lib/telegramClient';
import {
  AutonomyCheckResult,
  AutonomyStatus,
  loadAutonomyStatus,
  STATUS_KV_KEY,
} from './fullAutonomy';

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: TelegramChat;
  from?: TelegramUser;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

interface HandleResult {
  handled: boolean;
  chatId?: string;
  response?: string;
  status?: AutonomyStatus | null;
}

const SERVER_PORT = Number(process.env.TELEGRAM_STATUS_PORT || process.env.PORT || 8787);

let telegramCredentialsLoaded = false;

function iconForState(state: AutonomyCheckResult['state']): string {
  switch (state) {
    case 'ok':
      return '✅';
    case 'fail':
      return '❌';
    case 'warn':
      return '⚠️';
    default:
      return '⏳';
  }
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'unscheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

function formatChecks(checks: AutonomyCheckResult[]): string {
  if (!checks.length) return 'No checks recorded';
  return checks
    .map((check) => {
      const icon = iconForState(check.state);
      const detail = check.detail && check.state !== 'ok' ? ` (${check.detail})` : '';
      return `${icon} ${check.label}${detail}`;
    })
    .join(', ');
}

function formatStatusMessage(status: AutonomyStatus | null): string {
  if (!status) {
    return [
      '⚠️ Maggie Status',
      '• Last run: unknown',
      '• Current task: unknown',
      '• Last checks: no data available',
      '• Next run: unscheduled',
    ].join('\n');
  }

  const icon = status.summary.failures > 0 ? '❌' : status.summary.warnings > 0 ? '⚠️' : '✅';
  const lines = [
    `${icon} Maggie Status`,
    `• Last run: ${formatTimestamp(status.timestamp)}`,
    `• Current task: ${status.currentTask || 'unknown'}`,
    `• Last checks: ${formatChecks(status.checks)}`,
    `• Next run: ${formatTimestamp(status.nextRun)}`,
  ];
  return lines.join('\n');
}

function flattenStringEntries(
  value: unknown,
  path: string[] = [],
  bucket: { path: string[]; value: string }[] = [],
): { path: string[]; value: string }[] {
  if (typeof value === 'string') {
    bucket.push({ path, value });
    return bucket;
  }

  if (!value || typeof value !== 'object') {
    return bucket;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    flattenStringEntries(entry, [...path, key], bucket);
  }
  return bucket;
}

function findTelegramCredentials(payload: Record<string, unknown>): {
  token?: string;
  chatId?: string;
} {
  const candidates: Array<Record<string, unknown>> = [];
  const direct = payload.telegram;
  if (direct && typeof direct === 'object') candidates.push(direct as Record<string, unknown>);

  const nested = [
    payload.notifications,
    payload.services,
    payload.bots,
    payload.config,
  ];
  for (const entry of nested) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      if (/telegram/i.test(key)) {
        candidates.push(value as Record<string, unknown>);
      }
    }
  }

  for (const candidate of candidates) {
    const token =
      (candidate.botToken as string | undefined) ||
      (candidate.token as string | undefined) ||
      (candidate.telegramBotToken as string | undefined);
    const chatId =
      (candidate.chatId as string | undefined) ||
      (candidate.chat_id as string | undefined) ||
      (candidate.channel as string | undefined) ||
      (candidate.telegramChatId as string | undefined);
    if (token || chatId) {
      return { token, chatId };
    }
  }

  const flattened = flattenStringEntries(payload);
  const tokenEntry = flattened.find((entry) => {
    const joined = entry.path.join('.').toLowerCase();
    return joined.includes('telegram') && joined.includes('token');
  });
  const chatEntry = flattened.find((entry) => {
    const joined = entry.path.join('.').toLowerCase();
    return joined.includes('telegram') && joined.includes('chat') && joined.includes('id');
  });

  const fallbackToken = flattened.find((entry) => entry.path.join('.') === 'TELEGRAM_BOT_TOKEN');
  const fallbackChat = flattened.find((entry) => entry.path.join('.') === 'TELEGRAM_CHAT_ID');

  return {
    token: tokenEntry?.value || fallbackToken?.value,
    chatId: chatEntry?.value || fallbackChat?.value,
  };
}

async function loadThreadState(): Promise<Record<string, unknown> | null> {
  const keys = ['PostQ:thread-state', 'thread-state'];
  for (const key of keys) {
    try {
      const raw = await getConfigValue<string>(key as string);
      if (typeof raw === 'string' && raw.trim().length) {
        try {
          return JSON.parse(raw) as Record<string, unknown>;
        } catch (err) {
          console.warn(`[telegram-status] Unable to parse ${key} payload as JSON:`, err);
        }
      }
    } catch (err) {
      console.warn(`[telegram-status] Failed to fetch ${key} from KV:`, err);
    }
  }
  return null;
}

async function ensureTelegramCredentials(): Promise<void> {
  if (
    telegramCredentialsLoaded ||
    (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
  ) {
    telegramCredentialsLoaded = true;
    return;
  }

  const state = await loadThreadState();
  if (!state) {
    console.warn('[telegram-status] No thread-state payload available to load Telegram credentials.');
    telegramCredentialsLoaded = true;
    return;
  }

  const { token, chatId } = findTelegramCredentials(state);
  if (token && !process.env.TELEGRAM_BOT_TOKEN) {
    process.env.TELEGRAM_BOT_TOKEN = token;
  }
  if (chatId && !process.env.TELEGRAM_CHAT_ID) {
    process.env.TELEGRAM_CHAT_ID = chatId;
  }
  telegramCredentialsLoaded = true;
}

function allowedChat(chatId: string): boolean {
  const configured = process.env.TELEGRAM_CHAT_ID;
  return !configured || configured === chatId;
}

function extractCommand(text: string): { name: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.split(/\s+/);
  const command = parts[0].slice(1).split('@')[0].toLowerCase();
  const args = parts.slice(1).map((part) => part.toLowerCase());
  return { name: command, args };
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<HandleResult> {
  const message = update.message || update.edited_message || update.channel_post;
  if (!message?.text) {
    return { handled: false };
  }

  await ensureTelegramCredentials();

  const chatId = String(message.chat.id);
  if (!allowedChat(chatId)) {
    console.warn('[telegram-status] Ignoring command from unauthorized chat', chatId);
    return { handled: false };
  }

  const command = extractCommand(message.text);
  if (!command) {
    return { handled: false };
  }

  const isStatusCommand =
    command.name === 'status' || (command.name === 'maggie' && command.args[0] === 'status');

  if (!isStatusCommand) {
    return { handled: false };
  }

  const status = await loadAutonomyStatus(STATUS_KV_KEY);
  const text = formatStatusMessage(status);
  await sendTelegramMessage(text, { chatId }).catch((err) => {
    console.error('[telegram-status] Failed to send Telegram reply:', err);
  });

  return { handled: true, chatId, response: text, status };
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });

    req.on('end', async () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        const update = body ? (JSON.parse(body) as TelegramUpdate) : ({} as TelegramUpdate);
        await handleTelegramUpdate(update);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('[telegram-status] Failed to process webhook:', err);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
      }
    });
  });

  server.listen(SERVER_PORT, () => {
    console.log(`[telegram-status] Listening for Telegram webhooks on port ${SERVER_PORT}`);
  });
}

if (import.meta.main) {
  startServer();
}

