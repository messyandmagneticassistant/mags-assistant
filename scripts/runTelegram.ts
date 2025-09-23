import { publishSite } from './publishSite';
import { selfHeal } from './selfHeal';
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

async function handleStatus(chatId: string) {
  const [worker, browserless, tikTok] = await Promise.all([
    fetchWorkerHealth(),
    Promise.resolve(describeBrowserless()),
    Promise.resolve(describeTikTokSessions()),
  ]);

  const timestamp = new Date().toISOString();
  const message = `🛰️ <b>Maggie Status</b>\n${worker}\n${browserless}\n${tikTok}\n⏱️ <i>${timestamp}</i>`;
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
    case '/publish-site':
      await handlePublish(chatId);
      break;
    case '/self-heal':
      await handleSelfHeal(chatId);
      break;
    default:
      await sendReply(chatId, '🤖 Unknown command. Try /status, /publish-site, or /self-heal.');
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
