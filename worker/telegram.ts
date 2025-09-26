import type { Env } from './lib/env';
import { loadState, saveState, sendTelegram } from './lib/state';
import { getSchedulerSnapshot, stopSchedulers, wakeSchedulers, tickScheduler } from './scheduler';
import { getOpenProjects } from './progress';

interface TelegramChat {
  id?: number | string;
}

interface TelegramFrom {
  id?: number | string;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
}

interface TelegramMessage {
  text?: string;
  caption?: string;
  chat?: TelegramChat;
  from?: TelegramFrom;
}

export interface TelegramUpdate {
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_message?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  [key: string]: unknown;
}

interface TelegramMeta {
  webhookUrl?: string;
  lastCheckAt?: string;
}

const TELEGRAM_META_KEY = 'telegramMeta';
const WEBHOOK_REFRESH_MS = 30 * 60 * 1000;

function extractMessage(update: TelegramUpdate): TelegramMessage | undefined {
  return update.message || update.channel_post || update.edited_message || update.edited_channel_post;
}

function commandFromText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return '';
  const first = trimmed.split(/\s+/)[0] || '';
  return first.split('@')[0] || '';
}

function resolveWebhookUrl(env: Env, origin?: string): string | undefined {
  if ((env as any).TELEGRAM_WEBHOOK_URL) {
    return String((env as any).TELEGRAM_WEBHOOK_URL);
  }
  if (!origin) return undefined;
  return `${origin.replace(/\/$/, '')}/telegram`;
}

async function updateTelegramMeta(env: Env, meta: TelegramMeta): Promise<void> {
  const state = await loadState(env);
  const stored = typeof (state as any)[TELEGRAM_META_KEY] === 'object' ? (state as any)[TELEGRAM_META_KEY] : {};
  (state as any)[TELEGRAM_META_KEY] = { ...stored, ...meta };
  await saveState(env, state);
}

async function readTelegramMeta(env: Env): Promise<TelegramMeta> {
  const state = await loadState(env);
  const meta = (state as any)[TELEGRAM_META_KEY];
  if (meta && typeof meta === 'object') {
    return meta as TelegramMeta;
  }
  return {};
}

export async function ensureTelegramWebhook(env: Env, origin?: string): Promise<void> {
  const token = (env as any).TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const webhookUrl = resolveWebhookUrl(env, origin);
  if (!webhookUrl) return;

  const meta = await readTelegramMeta(env);
  const lastCheck = meta.lastCheckAt ? new Date(meta.lastCheckAt).getTime() : 0;
  const now = Date.now();
  if (meta.webhookUrl === webhookUrl && now - lastCheck < WEBHOOK_REFRESH_MS) {
    return;
  }

  try {
    const body = new URLSearchParams({ url: webhookUrl });
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      body,
    });
    if (!res.ok) {
      throw new Error(`Failed to set webhook: ${res.status}`);
    }
    const payload = await res.json().catch(() => ({}));
    if (!payload?.ok) {
      throw new Error(`Telegram rejected webhook: ${JSON.stringify(payload)}`);
    }
    await updateTelegramMeta(env, {
      webhookUrl,
      lastCheckAt: new Date(now).toISOString(),
    });
  } catch (err) {
    console.warn('[telegram] webhook registration failed', err);
    await updateTelegramMeta(env, {
      lastCheckAt: new Date(now).toISOString(),
    });
  }
}

async function repingAutomation(env: Env): Promise<void> {
  const state = await loadState(env);
  const actions = [
    'TikTok scheduler pinged',
    'Website builder pinged',
    'Retry loop reset',
  ];
  const autonomy = typeof state.autonomy === 'object' && state.autonomy ? state.autonomy : {};
  autonomy.lastActions = actions;
  autonomy.lastRunAt = new Date().toISOString();
  state.autonomy = autonomy;
  await saveState(env, state);
}

function buildStatusPayload(snapshot: Awaited<ReturnType<typeof getSchedulerSnapshot>>, state: any) {
  const social = {
    scheduled: snapshot.scheduledPosts,
    retrying: snapshot.retryQueue,
    nextRetryAt: snapshot.nextRetryAt,
  };
  const status = {
    time: new Date().toISOString(),
    tasks: snapshot.currentTasks,
    website: state?.website || 'https://messyandmagnetic.com',
    social,
    topTrends: snapshot.topTrends,
    paused: snapshot.paused,
  };
  return status;
}

async function handleStatus(env: Env): Promise<void> {
  const snapshot = await tickScheduler(env);
  const state = await loadState(env);
  const payload = buildStatusPayload(snapshot, state);
  const json = JSON.stringify(payload, null, 2);
  await sendTelegram(env, `\uD83D\uDCCA Maggie status\n${json}`);
}

async function handleWake(env: Env): Promise<void> {
  const snapshot = await wakeSchedulers(env);
  await repingAutomation(env);
  await sendTelegram(env, '✅ Maggie restarted');
  await sendTelegram(env, `Tasks now: ${snapshot.currentTasks.slice(0, 3).join(', ')}`);
}

async function handleStop(env: Env): Promise<void> {
  await stopSchedulers(env);
  await sendTelegram(env, '🛑 Maggie paused');
}

async function handleHelp(env: Env): Promise<void> {
  await sendTelegram(
    env,
    [
      'ℹ️ Maggie controls:',
      '/status – JSON summary of tasks + trends',
      '/wake – restart automation loop',
      '/stop – pause schedulers (Telegram stays live)',
      '/projects – list active project pipelines',
      '/help – show this help',
    ].join('\n')
  );
}

function formatTimestamp(value?: string): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

async function handleProjects(env: Env): Promise<void> {
  const projects = await getOpenProjects(env);
  if (!projects.length) {
    await sendTelegram(env, 'No active projects right now.');
    return;
  }
  const lines: string[] = ['📋 Active Projects:'];
  for (const project of projects) {
    const currentStep = project.currentStep?.trim() || 'Not started yet';
    const started = formatTimestamp(project.startedAt);
    lines.push(`• ${project.name}`);
    lines.push(`  • Current: ${currentStep}`);
    lines.push(`  • Started: ${started}`);
    lines.push(`  • Steps completed: ${project.stepsCompleted}`);
  }
  await sendTelegram(env, lines.join('\n'));
}

async function acknowledgeText(env: Env, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  await sendTelegram(
    env,
    `👂 Listening: “${trimmed.slice(0, 200)}”\nCommands available: /status, /wake, /stop, /help`
  );
}

export async function handleTelegramUpdate(update: TelegramUpdate, env: Env, origin?: string): Promise<void> {
  await ensureTelegramWebhook(env, origin);
  const message = extractMessage(update);
  const text = (message?.text || message?.caption || '').trim();
  if (!text) return;
  if (message?.from?.is_bot) return;

  const command = commandFromText(text);
  if (command) {
    if (command === '/status') {
      await handleStatus(env);
    } else if (command === '/wake') {
      await handleWake(env);
    } else if (command === '/stop') {
      await handleStop(env);
    } else if (command === '/help') {
      await handleHelp(env);
    } else if (command === '/projects') {
      await handleProjects(env);
    } else if (command === '/summary') {
      await handleStatus(env);
    } else {
      await handleHelp(env);
    }
    return;
  }

  await acknowledgeText(env, text);
}
