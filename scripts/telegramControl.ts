import process from 'node:process';

import { getConfigValue, putConfig, deleteConfigKey } from '../lib/kv';
import { runFullAutonomy, type HeartbeatStatus } from './fullAutonomy';
import { hydrateEnvFromThreadState } from './lib/threadState';
import { sendTelegramMessage } from './lib/telegramClient';

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
  from?: { id: number; username?: string; first_name?: string; last_name?: string };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

const POLL_TIMEOUT_SEC = 30;
const ERROR_BACKOFF_MS = 5000;
const HEARTBEAT_KEY = 'status:last';
const PAUSE_KEY = 'autonomy:paused';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function titleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString()} (${date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })})`;
}

async function ensureTelegramEnv(): Promise<{ token: string; chatId: string }> {
  await hydrateEnvFromThreadState();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('Telegram credentials missing in environment and KV.');
  }
  return { token, chatId };
}

async function fetchUpdates(token: string, offset: number): Promise<TelegramUpdate[] | null> {
  const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
  url.searchParams.set('timeout', String(POLL_TIMEOUT_SEC));
  url.searchParams.set('offset', String(offset));

  try {
    const res = await fetch(url.toString());
    const data = await res.json().catch(() => null);
    if (!data?.ok) {
      console.warn('[telegram-control] getUpdates returned non-ok response:', data);
      return null;
    }
    return Array.isArray(data.result) ? (data.result as TelegramUpdate[]) : [];
  } catch (err) {
    console.error('[telegram-control] getUpdates failed:', err);
    return null;
  }
}

async function sendReply(chatId: string, text: string) {
  await sendTelegramMessage(text, { chatId }).catch((err) => {
    console.error('[telegram-control] Failed to send reply:', err);
  });
}

async function fetchHeartbeat(): Promise<HeartbeatStatus | null> {
  try {
    const value = (await getConfigValue<HeartbeatStatus>(HEARTBEAT_KEY, {
      type: 'json',
    })) as HeartbeatStatus;
    if (value && typeof value === 'object') return value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/404/.test(message) && !/not found/i.test(message)) {
      console.warn('[telegram-control] Unable to read heartbeat:', message);
    }
  }
  return null;
}

function formatHeartbeat(status: HeartbeatStatus): string {
  const lines: string[] = [];
  lines.push('🩺 <b>Autonomy heartbeat</b>');
  lines.push(`• Last run: <code>${escapeHtml(formatTimestamp(status.lastRun))}</code>`);
  lines.push(`• Current task: <b>${escapeHtml(status.currentTask)}</b>`);
  lines.push(`• Next run: <code>${escapeHtml(formatTimestamp(status.nextRun))}</code>`);

  const checks = Object.values(status.lastHealthChecks || {});
  if (checks.length) {
    lines.push('');
    lines.push('<b>Health checks</b>');
    for (const check of checks) {
      const icon = check.ok ? '✅' : '❌';
      const detail = escapeHtml(check.detail);
      lines.push(`${icon} <b>${escapeHtml(titleCase(check.service))}</b> — ${detail}`);
    }
  }

  if (status.notes?.length) {
    lines.push('');
    lines.push(`<b>Notes:</b> ${escapeHtml(status.notes.join(', '))}`);
  }

  return lines.join('\n');
}

function allowedChat(chatId: string, allowed: string): boolean {
  return !allowed || allowed === chatId;
}

async function handleStatus(chatId: string) {
  const snapshot = await fetchHeartbeat();
  if (!snapshot) {
    await sendReply(chatId, 'ℹ️ No heartbeat found yet.');
    return;
  }
  await sendReply(chatId, formatHeartbeat(snapshot));
}

async function handleRetry(chatId: string) {
  await sendReply(chatId, '🔁 Running autonomy cycle now…');
  try {
    const status = await runFullAutonomy({ triggeredBy: 'telegram:retry', force: true });
    await sendReply(chatId, `✅ Autonomy run complete.\n${formatHeartbeat(status)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendReply(chatId, `❌ Autonomy run failed.\n<code>${escapeHtml(message)}</code>`);
  }
}

async function handlePause(chatId: string) {
  try {
    await putConfig(PAUSE_KEY, 'true');
    await sendReply(chatId, '⏸ Autonomy paused.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendReply(chatId, `❌ Failed to pause autonomy.\n<code>${escapeHtml(message)}</code>`);
  }
}

async function handleResume(chatId: string) {
  try {
    await deleteConfigKey(PAUSE_KEY);
    await sendReply(chatId, '▶️ Autonomy resumed.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendReply(chatId, `❌ Failed to resume autonomy.\n<code>${escapeHtml(message)}</code>`);
  }
}

async function handleCommand(chatId: string, text: string) {
  const [rawCommand] = text.trim().split(/\s+/);
  if (!rawCommand.startsWith('/')) return;
  const command = rawCommand.toLowerCase().split('@')[0];
  console.log('[telegram-control] Received command', command, 'from', chatId);

  switch (command) {
    case '/status':
      await handleStatus(chatId);
      break;
    case '/retry':
      await handleRetry(chatId);
      break;
    case '/pause':
      await handlePause(chatId);
      break;
    case '/resume':
      await handleResume(chatId);
      break;
    default:
      await sendReply(chatId, '🤖 Commands: /status, /retry, /pause, /resume');
  }
}

async function runLoop(token: string, allowedChatId: string) {
  let offset = 0;
  console.log('[telegram-control] Listening for commands…');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const updates = await fetchUpdates(token, offset);
    if (!updates) {
      await new Promise((resolve) => setTimeout(resolve, ERROR_BACKOFF_MS));
      continue;
    }

    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      const message = update.message;
      if (!message?.text) continue;
      const chatId = String(message.chat.id);
      if (!allowedChat(chatId, allowedChatId)) {
        console.warn('[telegram-control] Ignoring message from unauthorized chat', chatId);
        continue;
      }
      try {
        await handleCommand(chatId, message.text);
      } catch (err) {
        console.error('[telegram-control] Command handler crashed:', err);
        await sendReply(chatId, '❌ Command failed. Check logs for details.');
      }
    }
  }
}

async function runCli() {
  try {
    const { token, chatId } = await ensureTelegramEnv();
    await runLoop(token, chatId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[telegram-control] Fatal error:', message);
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(`file://${process.argv[1] ?? ''}`).href) {
  runCli();
}

