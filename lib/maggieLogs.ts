import { appendRows } from './google.ts';

const LOG_SHEET_ID =
  process.env.MAGGIE_LOG_SHEET_ID || process.env.GOOGLE_SHEET_ID || process.env.LOG_SHEET_ID;
const LOCAL_TZ = process.env.MAGGIE_LOCAL_TZ || process.env.TZ || 'America/Los_Angeles';

interface TimestampBundle {
  utc: string;
  local: string;
}

function formatTimestamps(timestamp?: string | number | Date): TimestampBundle {
  const date = timestamp ? new Date(timestamp) : new Date();
  const utc = date.toISOString();
  const local = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: LOCAL_TZ,
  }).format(date);
  return { utc, local: `${local} (${LOCAL_TZ})` };
}

function normalizeError(error?: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.stack || error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function append(range: string, values: (string | number)[][]): Promise<void> {
  if (!LOG_SHEET_ID) {
    console.warn('[maggieLogs] Missing MAGGIE_LOG_SHEET_ID/GOOGLE_SHEET_ID; skipping log append.');
    return;
  }
  try {
    await appendRows(LOG_SHEET_ID, range, values);
  } catch (err) {
    console.warn('[maggieLogs] Failed to append rows:', err);
  }
}

export interface BrainSyncLogInput {
  kvKey: string;
  status: 'success' | 'fail' | 'prepared';
  trigger?: string;
  source?: string;
  timestamp?: string;
  error?: unknown;
}

export async function logBrainSyncToSheet(input: BrainSyncLogInput): Promise<void> {
  const ts = formatTimestamps(input.timestamp);
  const trigger = input.trigger || input.source || 'manual';
  const status = input.status === 'fail' ? 'fail' : input.status === 'prepared' ? 'success' : input.status;
  const error =
    input.status === 'fail'
      ? normalizeError(input.error)
      : input.status === 'prepared' && input.error
      ? `prepared: ${normalizeError(input.error)}`
      : normalizeError(input.error);
  await append("'Brain Syncs'!A:F", [
    [ts.utc, ts.local, input.kvKey, trigger, status, error],
  ]);
}

export interface ErrorLogInput {
  module: string;
  error: unknown;
  recovery?: string;
  timestamp?: string;
}

export async function logErrorToSheet(input: ErrorLogInput): Promise<void> {
  const ts = formatTimestamps(input.timestamp);
  await append("'Errors'!A:D", [
    [ts.utc, input.module, normalizeError(input.error), input.recovery ? String(input.recovery) : ''],
  ]);
}
