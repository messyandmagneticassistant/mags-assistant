import { google } from 'googleapis';
import { Client as NotionClient } from '@notionhq/client';

export type RepairTrigger = 'cron' | 'telegram' | 'manual';

export interface RepairLogPayload {
  action: 'merge' | 'restart' | 'deploy' | 'check';
  trigger: RepairTrigger;
  success: boolean;
  message: string;
  timestamp?: Date;
  details?: Record<string, unknown>;
}

interface LogResult {
  notion?: { ok: boolean; error?: string };
  sheets?: { ok: boolean; error?: string };
}

function ensureDate(value?: Date): Date {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
}

async function logToNotion(payload: RepairLogPayload): Promise<{ ok: boolean; error?: string }> {
  const notionToken = process.env.NOTION_TOKEN || process.env.NOTION_API_TOKEN;
  const notionDb = process.env.NOTION_MAGGIE_EVENTS_DB || process.env.NOTION_MAGGIE_SYSTEM_EVENTS_DB;

  if (!notionToken || !notionDb) {
    return { ok: false, error: 'Missing Notion env (NOTION_TOKEN + NOTION_MAGGIE_EVENTS_DB)' };
  }

  const notion = new NotionClient({ auth: notionToken });
  const ts = ensureDate(payload.timestamp).toISOString();

  try {
    await notion.pages.create({
      parent: { database_id: notionDb },
      properties: {
        Name: {
          title: [
            {
              text: {
                content: `${payload.action.toUpperCase()} • ${payload.success ? '✅' : '⚠️'} • ${new Date(ts).toLocaleString()}`,
              },
            },
          ],
        },
        Action: {
          select: { name: payload.action },
        },
        Trigger: {
          select: { name: payload.trigger },
        },
        Status: {
          select: { name: payload.success ? 'Success' : 'Failure' },
        },
        Timestamp: {
          date: { start: ts },
        },
        Message: {
          rich_text: [
            {
              text: { content: payload.message.slice(0, 1800) },
            },
          ],
        },
      },
    });
    return { ok: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn('[self-healing] failed to log Notion event', errorMessage);
    return { ok: false, error: errorMessage };
  }
}

function getGoogleAuth() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    return null;
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function logToGoogleSheets(payload: RepairLogPayload): Promise<{ ok: boolean; error?: string }> {
  const spreadsheetId = process.env.GOOGLE_MAGGIE_AUTOFIX_SHEET_ID || process.env.GOOGLE_SHEETS_MAGGIE_AUTOFIX_ID;
  if (!spreadsheetId) {
    return { ok: false, error: 'Missing Google Sheet ID env (GOOGLE_MAGGIE_AUTOFIX_SHEET_ID)' };
  }

  const auth = getGoogleAuth();
  if (!auth) {
    return { ok: false, error: 'Missing Google service account credentials' };
  }

  const sheets = google.sheets({ version: 'v4', auth });
  const ts = ensureDate(payload.timestamp).toISOString();

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:E',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[ts, payload.action, payload.trigger, payload.success ? 'success' : 'failure', payload.message]],
      },
    });
    return { ok: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn('[self-healing] failed to log Google Sheets event', errorMessage);
    return { ok: false, error: errorMessage };
  }
}

export async function logRepairEvent(payload: RepairLogPayload): Promise<LogResult> {
  const timestamp = ensureDate(payload.timestamp);
  const enriched: RepairLogPayload = { ...payload, timestamp };
  const [notion, sheets] = await Promise.all([logToNotion(enriched), logToGoogleSheets(enriched)]);
  return { notion, sheets };
}
