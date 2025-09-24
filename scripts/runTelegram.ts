import { publishSite } from './publishSite';
import { selfHeal } from './selfHeal';
import { buildDigest } from './digest';
import { sendTelegramMessage } from './lib/telegramClient';

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

const STATUS_TZ = 'America/Denver';

function resolveWorkerUrl(): string | null {
  const url = process.env.WORKER_URL || process.env.WORKER_BASE_URL;
  if (!url) return null;
  return url.replace(/\/$/, '');
}

async function fetchAutonomyStatus(): Promise<any | null> {
  const base = resolveWorkerUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/status`);
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch (err) {
    console.error('[telegram] Failed to fetch worker /status:', err);
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatStatusTime(value: string | null | undefined): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: STATUS_TZ,
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${formatter.format(date)} (${STATUS_TZ})`;
}

function formatPreview(entries: string[] | undefined): string | null {
  if (!entries || !entries.length) return null;
  const first = escapeHtml(entries[0]);
  return entries.length > 1 ? `${first} (+${entries.length - 1})` : first;
}

async function handleStatus(chatId: string) {
  const [worker, browserless, tikTok, autonomy] = await Promise.all([
    fetchWorkerHealth(),
    Promise.resolve(describeBrowserless()),
    Promise.resolve(describeTikTokSessions()),
    fetchAutonomyStatus(),
  ]);

  const lines: string[] = ['🛰️ <b>Maggie Status</b>'];

  if (autonomy) {
    lines.push(`• Last run: <code>${formatStatusTime(autonomy.lastRun)}</code>`);
    lines.push(`• Next: <code>${formatStatusTime(autonomy.nextRun)}</code>`);
    const queue = autonomy.socialQueue || {};
    lines.push(
      `• Queue: ${queue.scheduled ?? 0} scheduled / ${queue.flopsRetry ?? 0} retry${
        queue.nextPost ? ` (next ${escapeHtml(String(queue.nextPost))})` : ''
      }`,
    );
    if (typeof autonomy.summary === 'string') {
      lines.push(`• Summary: ${escapeHtml(autonomy.summary)}`);
    }
    const errorsPreview = formatPreview(autonomy.errors);
    if (errorsPreview) {
      lines.push(`• Errors: ${errorsPreview}`);
    } else {
      const warnPreview = formatPreview(autonomy.warnings);
      if (warnPreview) {
        lines.push(`• Warnings: ${warnPreview}`);
      }
    }
    if (Array.isArray(autonomy.actions) && autonomy.actions.length) {
      lines.push(`• Actions: ${formatPreview(autonomy.actions)}`);
    }
    if (autonomy.quiet?.muted) {
      lines.push('• Quiet hours: muted');
    }
    if (autonomy.critical) {
      lines.push('• Critical: yes');
    }
  } else {
    lines.push('• Autonomy status unavailable.');
  }

  lines.push(escapeHtml(worker));
  lines.push(escapeHtml(browserless));
  lines.push(escapeHtml(tikTok));
  lines.push(`⏱️ <i>${escapeHtml(new Date().toISOString())}</i>`);

  await sendReply(chatId, lines.join('\n'));
}

async function handleDigest(chatId: string, since?: string) {
  try {
    const result = await buildDigest(since ? { since } : {});
    await sendReply(chatId, result.text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendReply(chatId, `❌ <b>Digest failed</b>\n<code>${escapeHtml(message)}</code>`);
  }
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
  const tokens = text.trim().split(/\s+/);
  const raw = tokens[0];
  if (!raw?.startsWith('/')) return;
  const command = raw.toLowerCase().split('@')[0];
  const args = tokens.slice(1);
  console.log('[telegram] Received command', command, 'from chat', chatId);

  switch (command) {
    case '/status':
      await handleStatus(chatId);
      break;
    case '/digest':
      await handleDigest(chatId, args[0]);
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
