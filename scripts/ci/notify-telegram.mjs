#!/usr/bin/env node

const token = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
  console.log('[notify-telegram] Telegram credentials missing; skipping notification.');
  process.exit(0);
}

const status = (process.env.DEPLOY_STATUS || '').toLowerCase();
const outcome = (process.env.DEPLOY_STEP_STATUS || '').toLowerCase();
const success = status === 'success' && (outcome === '' || outcome === 'success');
const cancelled = status === 'cancelled';
const indicator = success ? '✅' : cancelled ? '⚪️' : '❌';

const repo = process.env.GITHUB_REPOSITORY || 'unknown-repo';
const ref = process.env.GITHUB_REF || 'unknown-ref';
const sha = (process.env.GITHUB_SHA || '').slice(0, 7);
const workflow = process.env.GITHUB_WORKFLOW || 'Deploy';
const url = process.env.DEPLOY_URL;
const error = process.env.DEPLOY_ERROR;

const lines = [
  `${indicator} Maggie deploy ${success ? 'succeeded' : cancelled ? 'was cancelled' : 'failed'}.`,
  `Repo: ${repo}`,
  `Ref: ${ref}`,
];

if (sha) lines.push(`Commit: ${sha}`);
lines.push(`Workflow: ${workflow}`);
if (url) lines.push(`URL: ${url}`);
if (error) lines.push(`Error: ${error}`);

const text = lines.join('\n');

const payload = {
  chat_id: chatId,
  text,
};

const threadId = process.env.TELEGRAM_THREAD_ID;
if (threadId) {
  payload.message_thread_id = Number(threadId) || threadId;
}

const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

if (!response.ok) {
  const body = await response.text().catch(() => '');
  console.error('[notify-telegram] Failed to send Telegram message:', body);
  process.exit(0);
}

console.log('[notify-telegram] Notification sent.');
