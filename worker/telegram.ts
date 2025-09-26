import type { Env } from './lib/env';
import { loadState, saveState, sendTelegram } from './lib/state';
import {
  getSchedulerSnapshot,
  stopSchedulers,
  wakeSchedulers,
  tickScheduler,
  type SchedulerSnapshot,
} from './scheduler';
import { getOpenProjects } from './progress';
import type { BrainInboxMessage, MaggieState } from '../shared/maggieState';

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
const INBOX_LIMIT = 30;

function extractMessage(update: TelegramUpdate): TelegramMessage | undefined {
  return update.message || update.channel_post || update.edited_message || update.edited_channel_post;
}

function commandFromText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return '';
  const first = trimmed.split(/\s+/)[0] || '';
  return first.split('@')[0] || '';
}

function generateMessageId(): string {
  const cryptoRef = (globalThis as any)?.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function formatList(items: string[], limit = 3, unit = 'item'): string {
  const normalized: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (!normalized.includes(trimmed)) {
      normalized.push(trimmed);
    }
  }
  if (!normalized.length) return '';
  const limited = normalized.slice(0, limit);
  if (normalized.length > limit) {
    const remaining = normalized.length - limit;
    const label = remaining === 1 ? unit : `${unit}s`;
    limited.push(`${remaining} more ${label}`);
  }
  if (limited.length === 1) return limited[0];
  if (limited.length === 2) return `${limited[0]} and ${limited[1]}`;
  return `${limited.slice(0, -1).join(', ')} and ${limited[limited.length - 1]}`;
}

async function loadSnapshot(env: Env): Promise<SchedulerSnapshot | null> {
  try {
    return await getSchedulerSnapshot(env);
  } catch (err) {
    console.warn('[telegram] failed to load scheduler snapshot:', err);
    return null;
  }
}

function pushWithLimit<T>(list: T[], value: T, limit: number): T[] {
  const next = [...list, value];
  while (next.length > limit) {
    next.shift();
  }
  return next;
}

async function recordInboxEntry(env: Env, message: TelegramMessage, text: string): Promise<{ entry: BrainInboxMessage; state: MaggieState }>
{
  const now = new Date().toISOString();
  const entry: BrainInboxMessage = {
    id: generateMessageId(),
    text,
    receivedAt: now,
    from:
      message.from?.first_name?.trim() ||
      message.from?.username?.trim() ||
      (message.from?.id ? String(message.from.id) : undefined),
    chatId: message.chat?.id ? String(message.chat.id) : undefined,
  };

  try {
    const state = await loadState(env);
    const inbox = Array.isArray(state.brainInbox) ? [...state.brainInbox] : [];
    const nextInbox = pushWithLimit(inbox, entry, INBOX_LIMIT);
    state.brainInbox = nextInbox;

    const autonomy =
      state.autonomy && typeof state.autonomy === 'object'
        ? { ...state.autonomy }
        : ({} as MaggieState['autonomy']);
    const pending = Array.isArray(autonomy?.pendingNotes) ? [...autonomy.pendingNotes] : [];
    autonomy!.pendingNotes = pushWithLimit(pending, entry, INBOX_LIMIT);
    autonomy!.inbox = nextInbox;
    const actions = Array.isArray(autonomy!.lastActions) ? [...autonomy!.lastActions] : [];
    actions.unshift(`Telegram note captured: ${text.slice(0, 80)}`);
    autonomy!.lastActions = actions.slice(0, 5);
    state.autonomy = autonomy!;

    state.lastTelegramAt = now;
    await saveState(env, state);
    return { entry, state };
  } catch (err) {
    console.warn('[telegram] failed to persist inbox entry:', err);
    return { entry, state: {} as MaggieState };
  }
}

function buildConversationReply(
  message: TelegramMessage,
  state: MaggieState,
  snapshot: SchedulerSnapshot | null,
): string {
  const name = message.from?.first_name?.trim() || message.from?.username?.trim();
  const greeting = `Hey${name ? ` ${name}` : ''}!`;

  const tasks = snapshot?.currentTasks?.length
    ? snapshot.currentTasks
    : Array.isArray(state.currentTasks)
      ? state.currentTasks
      : [];
  const tasksLine = tasks.length
    ? `I'm currently on ${formatList(tasks, 3, 'task')}.`
    : 'I'm keeping an eye on the automations right now.';

  let scheduleLine: string;
  if (snapshot?.paused) {
    scheduleLine = 'Schedulers are paused, so I'm holding space for manual work.';
  } else {
    const scheduledCount = typeof snapshot?.scheduledPosts === 'number'
      ? snapshot.scheduledPosts
      : Array.isArray(state.scheduledPosts)
        ? state.scheduledPosts.length
        : 0;
    scheduleLine = scheduledCount > 0
      ? `We have ${scheduledCount} post${scheduledCount === 1 ? '' : 's'} queued.`
      : 'The queue is open if you want to add anything new.';
  }

  const trends = Array.isArray(snapshot?.topTrends)
    ? snapshot!.topTrends
        .map((trend) => (typeof trend === 'string' ? trend : trend?.title || ''))
        .filter((title) => title && title.trim())
    : [];
  const trendsLine = trends.length ? `Today's spark is ${formatList(trends, 2, 'spark')}.` : '';

  const noteLine = `I wrote your note into Maggie's brain so it gets routed.`;
  const closing = `Anything else you'd like me to capture?`;

  const parts = [greeting, tasksLine, scheduleLine];
  if (trendsLine) parts.push(trendsLine);
  parts.push(noteLine, closing);
  return parts.join(' ');
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

async function handleFreeformMessage(env: Env, message: TelegramMessage, rawText: string): Promise<void> {
  const normalized = collapseWhitespace(rawText);
  if (!normalized) return;

  const { state } = await recordInboxEntry(env, message, normalized);
  const snapshot = await loadSnapshot(env);
  const reply = buildConversationReply(message, state, snapshot);
  await sendTelegram(env, reply);
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

  if (!message) return;
  await handleFreeformMessage(env, message, text);
}
