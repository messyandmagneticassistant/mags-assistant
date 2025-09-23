import { appendRows, addSheet, getSheets } from '../../lib/google.ts';

const LOG_SHEET_ID =
  process.env.MAGGIE_LOG_SHEET_ID || process.env.GOOGLE_SHEET_ID || process.env.LOG_SHEET_ID;
const LOCAL_TZ = process.env.MAGGIE_LOCAL_TZ || process.env.TZ || 'America/Los_Angeles';

const STATUS_TAB = 'Status Events';
const HEADERS = ['UTC', 'Local', 'Event', 'Detail', 'Outcome'] as const;

let ensurePromise: Promise<boolean> | null = null;
let isEnsured = false;

type TimestampInput = string | number | Date | undefined;

function formatTimestamps(input?: TimestampInput) {
  const date = input ? new Date(input) : new Date();
  const utc = date.toISOString();
  const local = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: LOCAL_TZ,
  }).format(date);
  return { utc, local: `${local} (${LOCAL_TZ})` };
}

function normalizeCell(value?: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function ensureSheet(): Promise<boolean> {
  if (!LOG_SHEET_ID) {
    console.warn('[status] Missing MAGGIE_LOG_SHEET_ID/GOOGLE_SHEET_ID; skipping status log append.');
    return false;
  }
  if (isEnsured) return true;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    try {
      const sheets = await getSheets();
      const meta = await sheets.spreadsheets.get({ spreadsheetId: LOG_SHEET_ID });
      const hasSheet = meta.data.sheets?.some((sheet) => sheet.properties?.title === STATUS_TAB);
      if (!hasSheet) {
        await addSheet(LOG_SHEET_ID, STATUS_TAB, [...HEADERS]);
      }
      isEnsured = true;
      return true;
    } catch (err: any) {
      const message = err?.message || '';
      const alreadyExists = typeof message === 'string' && message.includes('already exists');
      if (alreadyExists) {
        isEnsured = true;
        return true;
      }
      console.warn('[status] Failed to ensure Status Events sheet:', err);
      return false;
    } finally {
      ensurePromise = null;
    }
  })();

  return ensurePromise;
}

export interface StatusEventInput {
  event: string;
  detail?: unknown;
  outcome?: unknown;
  timestamp?: TimestampInput;
}

export async function writeStatusEvent(input: StatusEventInput): Promise<void> {
  if (!input?.event) return;
  const ok = await ensureSheet();
  if (!ok || !LOG_SHEET_ID) return;

  const ts = formatTimestamps(input.timestamp);
  const row: (string | number)[] = [
    ts.utc,
    ts.local,
    normalizeCell(input.event),
    normalizeCell(input.detail),
    normalizeCell(input.outcome),
  ];

  try {
    await appendRows(LOG_SHEET_ID, "'Status Events'!A:E", [row]);
  } catch (err) {
    console.warn('[status] Failed to append status event:', err);
  }
}

export function getStatusSheetId(): string | undefined {
  return LOG_SHEET_ID;
}

export const STATUS_SHEET_TAB = STATUS_TAB;
