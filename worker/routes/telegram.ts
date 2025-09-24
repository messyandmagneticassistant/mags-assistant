import type { Env } from '../lib/env';
import { sendTelegram } from '../lib/state';

interface TelegramUpdate {
  message?: {
    text?: string;
    caption?: string;
    chat?: { id?: number | string };
  };
  channel_post?: TelegramUpdate['message'];
  edited_message?: TelegramUpdate['message'];
  edited_channel_post?: TelegramUpdate['message'];
  [key: string]: unknown;
}

function extractMessage(update: TelegramUpdate) {
  return update.message || update.channel_post || update.edited_message || update.edited_channel_post;
}

function commandFromText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return '';
  const first = trimmed.split(/\s+/)[0] || '';
  return first.split('@')[0] || '';
}

async function fetchJson(url: string, headers: HeadersInit = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
}

function formatTasks(value: unknown): string {
  if (Array.isArray(value) && value.length) {
    return value.join(', ');
  }
  return 'idle';
}

function denverNow() {
  return new Date().toLocaleString('en-US', { timeZone: 'America/Denver' });
}

function summarizeTrends(value: unknown): string {
  if (!Array.isArray(value)) return '';
  const titles = value
    .slice(0, 3)
    .map((entry: any) => {
      if (!entry) return null;
      if (typeof entry === 'string') return entry;
      if (typeof entry.title === 'string') return entry.title;
      if (typeof entry.name === 'string') return entry.name;
      if (typeof entry.url === 'string') return entry.url;
      return null;
    })
    .filter((entry): entry is string => Boolean(entry));
  return titles.join(', ');
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const update = (await request.json().catch(() => ({}))) as TelegramUpdate;
  const message = extractMessage(update);
  const text = (message?.text || message?.caption || '').trim();
  if (!text) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const command = commandFromText(text);
  if (!command) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const origin = new URL(request.url).origin.replace(/\/$/, '');
  const headers: HeadersInit = {};
  if (env.POST_THREAD_SECRET) {
    headers['Authorization'] = `Bearer ${env.POST_THREAD_SECRET}`;
  }

  try {
    if (command === '/status') {
      const status = await fetchJson(`${origin}/status`, headers);
      const social = status.socialQueue || {};
      await sendTelegram(
        env,
        `📊 Maggie Status\n` +
          `⏰ ${denverNow()}\n` +
          `🧩 Tasks: ${formatTasks(status.currentTasks)}\n` +
          `🌐 Website: ${status.website || 'https://messyandmagnetic.com'}\n` +
          `📅 Social: ${social.scheduled ?? 0} scheduled, ${social.flopsRetry ?? 0} retries\n` +
          `➡️ Next: ${social.nextPost ?? 'none'}`,
      );
    } else if (command === '/summary') {
      const summary = await fetchJson(`${origin}/summary`, headers);
      const social = summary.socialQueue || {};
      const trends = summarizeTrends(summary.topTrends);
      await sendTelegram(
        env,
        `📒 Daily Summary\n` +
          `⏰ ${denverNow()}\n` +
          `🧩 Tasks: ${formatTasks(summary.currentTasks)}\n` +
          `🌐 Website: ${summary.website || 'https://messyandmagnetic.com'}\n` +
          `📅 Social: ${social.scheduled ?? 0} scheduled, ${social.flopsRetry ?? 0} retries\n` +
          `🔥 Trends: ${trends || 'n/a'}`,
      );
    }
  } catch (err) {
    console.warn('[telegram] Command handling failed:', err);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
