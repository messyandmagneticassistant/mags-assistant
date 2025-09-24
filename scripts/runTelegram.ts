import fs from 'node:fs/promises';
import path from 'node:path';

import { publishSite } from './publishSite';
import { selfHeal } from './selfHeal';
import { generateDigest } from './digest';
import { sendTelegramMessage } from './lib/telegramClient';
import { formatInTimeZone, QUIET_TIMEZONE } from './lib/timeUtils';

const POLL_TIMEOUT_SEC = 30;
const ERROR_BACKOFF_MS = 5000;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number; type: string; title?: string; username?: string; first_name?: string; last_name?: string };
    from?: { id: number; username?: string; first_name?: string; last_name?: string };
  };
}

function getToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required for runTelegram.ts');
  }
  return token;
}

function allowedChat(chatId: string): boolean {
  const configured = process.env.TELEGRAM_CHAT_ID;
  return !configured || configured === chatId;
}

async function sendReply(chatId: string, text: string) {
  await sendTelegramMessage(text, { chatId }).catch((err) => {
    console.error('[telegram] Failed to send reply:', err);
  });
}

async function notifyDefaultChannel(text: string, sourceChatId: string) {
  const configured = process.env.TELEGRAM_CHAT_ID;
  if (!configured || configured === sourceChatId) return;
  await sendTelegramMessage(text).catch(() => undefined);
}

async function fetchUpdates(token: string, offset: number): Promise<TelegramUpdate[] | null> {
  const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
  url.searchParams.set('timeout', String(POLL_TIMEOUT_SEC));
  url.searchParams.set('offset', String(offset));

  try {
    const res = await fetch(url.toString());
    const data = await res.json();
    if (!data?.ok) {
      console.warn('[telegram] getUpdates returned non-ok response:', data);
      return null;
    }
    return Array.isArray(data.result) ? data.result : [];
  } catch (err) {
    console.error('[telegram] getUpdates error:', err);
    return null;
  }
}

async function fetchWorkerHealth(): Promise<string> {
  const workerUrl = process.env.WORKER_URL || process.env.WORKER_BASE_URL;
  if (!workerUrl) return '⚠️ Worker URL not configured';
  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/health`);
    if (!res.ok) return `❌ Worker health HTTP ${res.status}`;
    const body = await res.text().catch(() => 'ok');
    return `✅ Worker responded ${res.status} (${body.slice(0, 80)})`;
  } catch (err) {
    return `❌ Worker health error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function describeBrowserless(): string {
  const base = process.env.BROWSERLESS_BASE_URL || process.env.BROWSERLESS_API_URL;
  const key = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN;
  if (!base) return '⚠️ No Browserless base URL';
  return key ? `✅ Browserless configured (${base})` : `🟡 Browserless URL set (${base}) but API key missing`;
}

function describeTikTokSessions(): string {
  const sessions = [
    process.env.TIKTOK_SESSION_MAIN,
    process.env.TIKTOK_SESSION_MAGGIE,
    process.env.TIKTOK_SESSION_WILLOW,
    process.env.TIKTOK_SESSION_MARS,
  ].filter((value): value is string => !!value && value.trim().length > 0);
  if (!sessions.length) return '⚠️ No TikTok session cookies loaded';
  return `✅ ${sessions.length} TikTok session cookie(s) present`;
}

async function fetchAutonomyStatus(): Promise<any | null> {
  const base =
    process.env.WORKER_URL ||
    process.env.WORKER_BASE_URL ||
    process.env.WORKER_ENDPOINT ||
    process.env.MAGS_WORKER_URL ||
    process.env.MAGGIE_WORKER_URL;
  if (!base) return null;
  const url = `${base.trim().replace(/\/$/, '')}/status`;
  const headers = new Headers();
  const token =
    process.env.WORKER_KEY ||
    process.env.POST_THREAD_SECRET ||
    process.env.MAGGIE_WORKER_KEY ||
    process.env.CF_WORKER_KEY ||
    process.env.AUTONOMY_WORKER_KEY;
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn('[telegram] /status returned', res.status);
      return null;
    }
    return res.json();
  } catch (err) {
    console.warn('[telegram] Failed to fetch /status:', err);
    return null;
  }
}

async function loadOpsQueueSummary(): Promise<{ queued: number; failures: number; lastRunAt: string | null } | null> {
  const queuePath = path.resolve('queue.json');
  try {
    const raw = await fs.readFile(queuePath, 'utf8');
    const parsed = JSON.parse(raw) as { items?: unknown[]; failures?: unknown[]; lastRunAt?: string };
    const queued = Array.isArray(parsed.items) ? parsed.items.length : 0;
    const failures = Array.isArray(parsed.failures) ? parsed.failures.length : 0;
    const lastRunAt = typeof parsed.lastRunAt === 'string' ? parsed.lastRunAt : null;
    return { queued, failures, lastRunAt };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[telegram] Unable to read queue.json:', err);
    }
    return null;
  }
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diff = Date.now() - date.getTime();
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return 'just now';
  if (abs < hour) {
    const minutes = Math.round(diff / minute);
    const value = Math.abs(minutes);
    const unit = value === 1 ? 'minute' : 'minutes';
    return minutes >= 0 ? `${value} ${unit} ago` : `in ${value} ${unit}`;
  }
  if (abs < day) {
    const hours = Math.round(diff / hour);
    const value = Math.abs(hours);
    const unit = value === 1 ? 'hour' : 'hours';
    return hours >= 0 ? `${value} ${unit} ago` : `in ${value} ${unit}`;
  }
  const days = Math.round(diff / day);
  const value = Math.abs(days);
  const unit = value === 1 ? 'day' : 'days';
  return days >= 0 ? `${value} ${unit} ago` : `in ${value} ${unit}`;
}

function describeTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'n/a';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const absolute = formatInTimeZone(date, QUIET_TIMEZONE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZoneName: 'short',
  });
  const relative = formatRelativeTime(iso);
  return `${absolute} (${relative})`;
}

async function handleStatus(chatId: string) {
  const [worker, browserless, tikTok, status, queue] = await Promise.all([
    fetchWorkerHealth(),
    Promise.resolve(describeBrowserless()),
    Promise.resolve(describeTikTokSessions()),
    fetchAutonomyStatus(),
    loadOpsQueueSummary(),
  ]);

  const timestamp = formatInTimeZone(new Date(), QUIET_TIMEZONE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZoneName: 'short',
  });

  const lines: string[] = [];
  lines.push('🛰️ <b>Maggie Status</b>');
  lines.push(`🕒 <i>${timestamp}</i>`);
  lines.push(worker);
  lines.push(browserless);
  lines.push(tikTok);

  if (status) {
    const autonomy = status.autonomy ?? {};
    const lastSummary = typeof autonomy.lastSummary === 'string' && autonomy.lastSummary.trim().length
      ? autonomy.lastSummary
      : 'No summary recorded.';
    lines.push(`🔁 Last run: ${describeTimestamp(autonomy.lastRunAt)} — ${lastSummary}`);
    const nextRun = typeof status.nextRun === 'string' ? status.nextRun : autonomy.lastNextRun;
    lines.push(`➡️ Next: ${describeTimestamp(typeof nextRun === 'string' ? nextRun : null)}`);
    const social = status.socialQueue ?? {};
    const scheduled = typeof social.scheduled === 'number' ? social.scheduled : 0;
    const retries = typeof social.flopsRetry === 'number' ? social.flopsRetry : 0;
    lines.push(`📅 Social queue: ${scheduled} scheduled • ${retries} retries`);
    const actions = Array.isArray(autonomy.lastActions) ? autonomy.lastActions : [];
    if (actions.length) {
      lines.push('⚙️ Actions:');
      for (const action of actions) {
        lines.push(`• ${action}`);
      }
    } else {
      lines.push('⚙️ Actions: none');
    }
    const errors = Array.isArray(autonomy.lastErrors) ? autonomy.lastErrors : [];
    if (errors.length) {
      lines.push('⚠️ Alerts:');
      for (const issue of errors) {
        const label = issue?.label ?? issue?.key ?? 'alert';
        const detail = issue?.detail ?? 'Check failed.';
        lines.push(`• ${label} — ${detail}`);
      }
    } else {
      lines.push('⚠️ Alerts: none');
    }
    const warnings = Array.isArray(autonomy.lastWarnings) ? autonomy.lastWarnings : [];
    if (warnings.length) {
      lines.push('🟡 Warnings:');
      for (const issue of warnings) {
        const label = issue?.label ?? issue?.key ?? 'warning';
        const detail = issue?.detail ?? 'Degraded check.';
        lines.push(`• ${label} — ${detail}`);
      }
    }
  } else {
    lines.push('ℹ️ Autonomy status unavailable.');
  }

  if (queue) {
    lines.push(`📦 Queue: ${queue.queued} queued • ${queue.failures} failures`);
    if (queue.lastRunAt) {
      lines.push(`Last worker tick: ${describeTimestamp(queue.lastRunAt)}`);
    }
  }

  const message = lines.filter(Boolean).join('\n');
  await sendReply(chatId, message);
}

async function handlePublish(chatId: string) {
  await sendReply(chatId, '🚀 Deploying latest <code>site/</code> assets…');
  try {
    const result = await publishSite({ triggeredBy: 'telegram', notify: false });
    const summary = `🚀 <b>Site deployed</b>\n• Files: <code>${result.manifest.assetCount}</code>\n• Removed: <code>${result.removedKeys.length}</code>\n• Triggered by: <b>telegram</b>`;
    await sendReply(chatId, summary);
    await notifyDefaultChannel(summary, chatId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const text = `❌ <b>Site deploy failed</b>\n<code>${message}</code>`;
    await sendReply(chatId, text);
    await notifyDefaultChannel(text, chatId);
  }
}

async function handleSelfHeal(chatId: string) {
  await sendReply(chatId, '🛠️ Running Maggie self-heal…');
  try {
    const summary = await selfHeal({ triggeredBy: 'telegram', notify: false });
    const lines = summary.results
      .map((result) => {
        const icon =
          result.status === 'ok'
            ? '✅'
            : result.status === 'recovered'
              ? '🟡'
              : result.status === 'skipped'
                ? '⚪️'
                : '❌';
        return `${icon} <b>${result.service}</b> — ${result.message}`;
      })
      .join('\n');
    const text = `🛠️ <b>Self-heal complete</b>\n${lines}\n⏱️ <i>${summary.startedAt} → ${summary.finishedAt}</i>`;
    await sendReply(chatId, text);
    await notifyDefaultChannel(text, chatId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const text = `❌ <b>Self-heal crashed</b>\n<code>${message}</code>`;
    await sendReply(chatId, text);
    await notifyDefaultChannel(text, chatId);
  }
}

async function handleCommand(chatId: string, text: string) {
  const [raw] = text.trim().split(/\s+/);
  if (!raw.startsWith('/')) return;
  const command = raw.toLowerCase().split('@')[0];
  console.log('[telegram] Received command', command, 'from chat', chatId);

  switch (command) {
    case '/status':
      await handleStatus(chatId);
      break;
    case '/digest':
      try {
        const digest = await generateDigest();
        await sendReply(chatId, digest.message);
        await notifyDefaultChannel(digest.message, chatId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await sendReply(chatId, `❌ <b>Digest failed</b>\n<code>${message}</code>`);
      }
      break;
    case '/publish-site':
      await handlePublish(chatId);
      break;
    case '/self-heal':
      await handleSelfHeal(chatId);
      break;
    default:
      await sendReply(chatId, '🤖 Unknown command. Try /status, /digest, /publish-site, or /self-heal.');
  }
}

async function processUpdate(update: TelegramUpdate): Promise<number> {
  const message = update.message;
  if (!message?.text) return update.update_id + 1;

  const chatId = String(message.chat.id);
  if (!allowedChat(chatId)) {
    console.warn('[telegram] Ignoring message from unauthorized chat', chatId);
    return update.update_id + 1;
  }

  try {
    await handleCommand(chatId, message.text);
  } catch (err) {
    console.error('[telegram] Failed to process command:', err);
    await sendReply(chatId, '❌ Maggie hit an error running that command. Check logs for details.');
  }

  return update.update_id + 1;
}

async function runLoop() {
  const token = getToken();
  let offset = 0;
  console.log('[telegram] Listening for commands…');

  while (true) {
    const updates = await fetchUpdates(token, offset);
    if (!updates) {
      await new Promise((resolve) => setTimeout(resolve, ERROR_BACKOFF_MS));
      continue;
    }

    if (!updates.length) {
      continue;
    }

    for (const update of updates) {
      offset = await processUpdate(update);
    }
  }
}

runLoop().catch((err) => {
  console.error('[telegram] Uncaught error in runTelegram.ts:', err);
  process.exitCode = 1;
});
