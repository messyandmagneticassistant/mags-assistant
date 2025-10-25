import { promises as fs } from 'node:fs';
import path from 'node:path';

import { logBrainSyncToSheet } from '../../lib/maggieLogs.ts';
import { getSheets } from '../../lib/google.ts';
import type { sheets_v4 } from 'googleapis';
import { writeStatusEvent } from '../status/writeStatus';
import { appendTaskLog, readRecentTasks, type TaskLogEntry } from '../status/taskLog';

const WORKER_BASE = 'https://maggie.messyandmagnetic.com';
const INIT_URL = `${WORKER_BASE}/init-blob`;
const DIAG_URL = `${WORKER_BASE}/diag/config`;
const HEALTH_URL = `${WORKER_BASE}/health`;
const KV_STATE_PATH = path.resolve('brain', 'brain.json');
const LOCAL_TZ = process.env.MAGGIE_LOCAL_TZ || process.env.TZ || 'America/Los_Angeles';
const STATUS_SHEET_ID =
  process.env.MAGGIE_LOG_SHEET_ID || process.env.GOOGLE_SHEET_ID || process.env.LOG_SHEET_ID;

export interface TelegramCommandContext {
  text: string;
  chatId?: string;
  reply: (message: string) => Promise<void>;
}

export type CommandHandler = (ctx: TelegramCommandContext) => Promise<void>;

export interface CommandDefinition {
  command: string;
  description: string;
  handler: CommandHandler;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatTimestamps(input?: Date | string | number) {
  const date = input ? new Date(input) : new Date();
  const utc = date.toISOString();
  const local = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: LOCAL_TZ,
  }).format(date);
  return { utc, local: `${local} (${LOCAL_TZ})` };
}

function truncate(value: string, max = 220) {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function readSecret(): string {
  const secret = process.env.POST_THREAD_SECRET;
  if (!secret) {
    throw new Error('POST_THREAD_SECRET is not configured.');
  }
  return secret;
}

async function readKvState(): Promise<string> {
  return fs.readFile(KV_STATE_PATH, 'utf8');
}

function safeJsonParse(input: string): any {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

async function fetchBrainSyncSheet(sheets: sheets_v4.Sheets): Promise<string[][]> {
  if (!STATUS_SHEET_ID) return [];
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: STATUS_SHEET_ID,
    range: "'Brain Syncs'!A:F",
  });
  return (res.data.values ?? []) as string[][];
}

async function fetchErrorsSheet(sheets: sheets_v4.Sheets): Promise<string[][]> {
  if (!STATUS_SHEET_ID) return [];
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: STATUS_SHEET_ID,
    range: "'Errors'!A:D",
  });
  return (res.data.values ?? []) as string[][];
}

function formatLastBrainSync(rows: string[][]): string {
  if (!rows.length) {
    return 'No syncs logged yet.';
  }
  const last = rows[rows.length - 1];
  const [utc, local, key, trigger, status, error] = last;
  const statusIcon = status === 'fail' ? '⚠️' : '✅';
  const details = [
    `${statusIcon} ${status || 'unknown'} • ${trigger || 'unknown trigger'}`,
    `UTC: ${utc || 'n/a'}`,
    `Local: ${local || 'n/a'}`,
  ];
  if (key) details.push(`KV: ${key}`);
  if (error) details.push(`Error: ${error}`);
  return details.join('\n');
}

function formatTaskLog(entries: TaskLogEntry[]): string {
  if (!entries.length) return 'No recent task log entries.';
  return entries
    .map((entry) => {
      const ts = formatTimestamps(entry.timestamp);
      const detailParts = [entry.task];
      if (entry.outcome) detailParts.push(`(${entry.outcome})`);
      if (entry.detail) detailParts.push(`- ${entry.detail}`);
      return `• ${ts.utc}\n  ${detailParts.join(' ')}`;
    })
    .join('\n');
}

function findRecentError(rows: string[][]): { utc: string; module: string; error: string; recovery?: string } | null {
  if (!rows.length) return null;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const [utc, module, error, recovery] = rows[i];
    const ts = Date.parse(utc || '');
    if (Number.isNaN(ts)) continue;
    if (ts < cutoff) continue;
    return { utc, module, error, recovery };
  }
  return null;
}

async function getHealthSummary(): Promise<{ status: number; body: string }> {
  try {
    const secret = process.env.POST_THREAD_SECRET;
    const res = await fetch(HEALTH_URL, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
    });
    const body = await res.text();
    return { status: res.status, body: truncate(body) };
  } catch (err) {
    return { status: 0, body: truncate(String(err instanceof Error ? err.message : err)) };
  }
}

async function handleHelp(ctx: TelegramCommandContext) {
  const lines = COMMANDS.map((cmd) => `• <code>${cmd.command}</code> — ${escapeHtml(cmd.description)}`);
  const message = ['<b>Maggie Telegram Commands</b>', ...lines].join('\n');
  await ctx.reply(message);
}

async function handleStartSync(ctx: TelegramCommandContext) {
  const startedAt = new Date();
  await writeStatusEvent({ event: 'start-sync', detail: 'telegram/manual', outcome: 'begin', timestamp: startedAt });

  await ctx.reply('⏳ Starting manual brain sync …');

  let initStatus = 0;
  let initBody = '';
  let diagStatus = 0;
  let diagBody = '';
  let diagSummary = '';
  let success = false;
  let errorMessage: string | undefined;

  try {
    const [secret, payload] = await Promise.all([Promise.resolve(readSecret()), readKvState()]);

    const postResp = await fetch(INIT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: payload,
    });
    initStatus = postResp.status;
    initBody = truncate(await postResp.text());

    const proceed = postResp.ok || postResp.status === 409;
    if (!proceed) {
      throw new Error(`init-blob failed (HTTP ${postResp.status})`);
    }

    const diagResp = await fetch(DIAG_URL, {
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    });
    diagStatus = diagResp.status;
    const diagRaw = await diagResp.text();
    diagBody = truncate(diagRaw);
    const diagJson = safeJsonParse(diagRaw);
    if (diagJson?.kv) {
      const { brainDocKey, brainDocBytes, secretBlobKey, secretBlobBytes } = diagJson.kv as Record<string, unknown>;
      diagSummary = [
        brainDocKey ? `brain=${brainDocKey}` : null,
        typeof brainDocBytes === 'number' ? `bytes=${brainDocBytes}` : null,
        secretBlobKey ? `secrets=${secretBlobKey}` : null,
        typeof secretBlobBytes === 'number' ? `secretBytes=${secretBlobBytes}` : null,
      ]
        .filter(Boolean)
        .join(' ');
    }

    success = diagResp.ok && proceed;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const finishedAt = new Date();
  const statusLabel = success ? 'success' : 'fail';
  const detailSummary = `init ${initStatus || 'n/a'} • diag ${diagStatus || 'n/a'}`;

  await Promise.all([
    writeStatusEvent({
      event: 'start-sync',
      detail: detailSummary,
      outcome: statusLabel,
      timestamp: finishedAt,
    }).catch(() => {}),
    appendTaskLog({ task: 'start-sync', outcome: statusLabel, detail: detailSummary }).catch(() => {}),
    logBrainSyncToSheet({
      kvKey: 'PostQ:thread-state',
      status: success ? 'success' : 'fail',
      trigger: 'telegram',
      source: 'manual',
      timestamp: finishedAt.toISOString(),
      error: success ? undefined : errorMessage || initBody || diagBody,
    }).catch(() => {}),
  ]);

  const startTs = formatTimestamps(startedAt);
  const finishTs = formatTimestamps(finishedAt);
  const parts = [
    `<b>Manual brain sync</b> — ${success ? '✅ OK' : '⚠️ Failed'}`,
    `Start: ${startTs.utc}`,
    `Start (local): ${startTs.local}`,
    `Finish: ${finishTs.utc}`,
    `Finish (local): ${finishTs.local}`,
    `init-blob → HTTP ${initStatus || 'n/a'}`,
  ];
  if (initBody) parts.push(`↳ <code>${escapeHtml(initBody)}</code>`);
  parts.push(`diag/config → HTTP ${diagStatus || 'n/a'}`);
  if (diagSummary) {
    parts.push(`↳ <code>${escapeHtml(diagSummary)}</code>`);
  } else if (diagBody) {
    parts.push(`↳ <code>${escapeHtml(diagBody)}</code>`);
  }
  if (errorMessage) {
    parts.push(`Error: <code>${escapeHtml(errorMessage)}</code>`);
  }
  parts.push('');
  parts.push(`<a href="${HEALTH_URL}">Worker /health</a>`);
  parts.push(`<a href="${DIAG_URL}">/diag/config</a>`);

  await ctx.reply(parts.join('\n'));
}

async function handleStatus(ctx: TelegramCommandContext) {
  const startedAt = new Date();
  const sheets = STATUS_SHEET_ID ? await getSheets().catch(() => null) : null;
  const [brainRows, errorRows, taskEntries, health] = await Promise.all([
    sheets ? fetchBrainSyncSheet(sheets).catch(() => []) : Promise.resolve([]),
    sheets ? fetchErrorsSheet(sheets).catch(() => []) : Promise.resolve([]),
    readRecentTasks(5).catch(() => []),
    getHealthSummary(),
  ]);

  const brainSummary = formatLastBrainSync(brainRows);
  const errorSummary = findRecentError(errorRows);

  const parts: string[] = [];
  parts.push('<b>Maggie status</b>');
  parts.push(brainSummary ? `🧠 Brain sync\n${escapeHtml(brainSummary)}` : '🧠 Brain sync\nNo entries.');
  parts.push(`🩺 Worker /health → HTTP ${health.status}\n<code>${escapeHtml(health.body)}</code>`);
  const tasksBlock = formatTaskLog(taskEntries);
  parts.push(`📝 Recent tasks\n${escapeHtml(tasksBlock)}`);
  if (errorSummary) {
    const errorLines = [
      `UTC: ${errorSummary.utc}`,
      errorSummary.module ? `Module: ${errorSummary.module}` : null,
      errorSummary.error ? `Error: ${errorSummary.error}` : null,
      errorSummary.recovery ? `Recovery: ${errorSummary.recovery}` : null,
    ].filter(Boolean);
    parts.push(`⚠️ Last error (24h)\n${escapeHtml(errorLines.join('\n'))}`);
  } else {
    parts.push('⚠️ Last error (24h)\nNone recorded.');
  }
  parts.push('');
  parts.push(`<a href="${HEALTH_URL}">Worker health</a>`);
  parts.push(`<a href="${DIAG_URL}">Diag config</a>`);

  const outcome = health.status >= 200 && health.status < 500 ? 'ok' : 'warn';
  await Promise.all([
    writeStatusEvent({ event: 'maggie-status', detail: `health ${health.status}`, outcome, timestamp: startedAt }).catch(
      () => {}
    ),
    ctx.reply(parts.join('\n')),
  ]);
}

export const COMMANDS: CommandDefinition[] = [
  {
    command: '/maggie-help',
    description: 'Show the list of supported Telegram commands.',
    handler: handleHelp,
  },
  {
    command: '/start-sync',
    description: 'Seed KV, verify brain payload, and log the run.',
    handler: handleStartSync,
  },
  {
    command: '/maggie-status',
    description: 'Show last brain sync, worker health, tasks, and recent errors.',
    handler: handleStatus,
  },
];
