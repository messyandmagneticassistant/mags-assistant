import { readFile } from 'fs/promises';
import path from 'path';
import type { drive_v3 } from 'googleapis';
import { getDrive, getDocs, getSheets } from '../../lib/google';
import { getSecrets } from '../config';
import { appendRows } from '../../lib/google';
import {
  NormalizedIntake,
  FulfillmentConfig,
  FulfillmentWorkspace,
  OrderSummary,
  FulfillmentMode,
} from './types';
import { tgSend } from '../lib/telegram';

let cachedConfig: FulfillmentConfig | null = null;
export interface SkuDefinition {
  tier?: string;
  addOns?: string[];
  fulfillmentType?: FulfillmentMode;
}

let cachedSkuMap: Record<string, SkuDefinition> | null = null;
let cachedIconLibrary: IconLibraryEntry[] | null = null;

interface IconLibraryEntry {
  slug: string;
  name: string;
  fileId: string;
  tone?: string;
  ageRanges?: string[];
  tags?: string[];
  folderUrl?: string;
}

interface LoadOptions {
  env?: any;
}

export async function loadFulfillmentConfig(opts: LoadOptions = {}): Promise<FulfillmentConfig> {
  if (cachedConfig) return cachedConfig;

  let secrets: any = {};
  try {
    secrets = await getSecrets(opts.env || {});
  } catch (err) {
    console.warn('[fulfillment.config] unable to load secrets from KV:', err);
  }

  const fromBlob = secrets?.fulfillment || secrets?.services?.fulfillment || {};

  const env = typeof process !== 'undefined' ? process.env : ({} as Record<string, string>);

  const config: FulfillmentConfig = {
    driveRootId:
      fromBlob.driveRootId ||
      env.FULFILLMENT_DRIVE_ROOT_ID ||
      env.MM_DRIVE_READY_ID ||
      env.MM_DRIVE_ROOT_ID ||
      '',
    blueprintTemplateId:
      fromBlob.blueprintTemplateId || env.FULFILLMENT_BLUEPRINT_TEMPLATE_ID,
    scheduleTemplates: {
      daily: fromBlob.scheduleTemplates?.daily || env.FULFILLMENT_SCHEDULE_DAILY_TEMPLATE_ID,
      weekly: fromBlob.scheduleTemplates?.weekly || env.FULFILLMENT_SCHEDULE_WEEKLY_TEMPLATE_ID,
      monthly: fromBlob.scheduleTemplates?.monthly || env.FULFILLMENT_SCHEDULE_MONTHLY_TEMPLATE_ID,
    },
    intakeFallbackFormUrl:
      fromBlob.intakeFallbackFormUrl || env.FULFILLMENT_INTAKE_FALLBACK_URL,
    sheetId: fromBlob.sheetId || env.FULFILLMENT_SHEET_ID,
    notionDatabaseId: fromBlob.notionDatabaseId || env.FULFILLMENT_NOTION_DB_ID,
    telegramChatId: fromBlob.telegramChatId || env.TELEGRAM_CHAT_ID,
    telegramBotToken: fromBlob.telegramBotToken || env.TELEGRAM_BOT_TOKEN,
    iconLibraryFolderId: fromBlob.iconLibraryFolderId || env.FULFILLMENT_ICON_LIBRARY_ID,
    resendFromEmail: fromBlob.resendFromEmail || env.RESEND_FROM_EMAIL,
    resendFromName: fromBlob.resendFromName || env.RESEND_FROM_NAME,
  };

  if (!config.driveRootId) {
    throw new Error(
      'Fulfillment drive root is not configured. Set FULFILLMENT_DRIVE_ROOT_ID or fulfillment.driveRootId in thread-state.'
    );
  }

  cachedConfig = config;
  return config;
}

export async function loadSkuMap(): Promise<Record<string, SkuDefinition>> {
  if (cachedSkuMap) return cachedSkuMap;
  const filePath = path.resolve(process.cwd(), 'config', 'sku-map.json');
  try {
    const raw = await readFile(filePath, 'utf8');
    cachedSkuMap = JSON.parse(raw);
  } catch (err) {
    console.warn('[fulfillment.config] Unable to load config/sku-map.json:', err);
    cachedSkuMap = {};
  }
  return cachedSkuMap;
}

export async function loadIconLibrary(): Promise<IconLibraryEntry[]> {
  if (cachedIconLibrary) return cachedIconLibrary;
  const filePath = path.resolve(process.cwd(), 'config', 'icon-library.json');
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    cachedIconLibrary = Array.isArray(parsed)
      ? parsed
      : Object.entries(parsed).map(([slug, value]: [string, any]) => ({ slug, ...(value || {}) }));
  } catch (err) {
    console.warn('[fulfillment.config] Unable to load config/icon-library.json:', err);
    cachedIconLibrary = [];
  }
  return cachedIconLibrary;
}

export function validateEmail(email?: string | null): boolean {
  if (!email) return false;
  const clean = email.trim();
  if (!clean) return false;
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(clean.toLowerCase());
}

export function splitName(name?: string | null): { firstName?: string; lastName?: string } {
  if (!name) return {};
  const parts = name
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (!parts.length) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.slice(-1)[0] };
}

export async function ensureOrderWorkspace(
  intake: NormalizedIntake,
  opts: LoadOptions = {}
): Promise<FulfillmentWorkspace> {
  const config = await loadFulfillmentConfig(opts);
  const drive = await getDrive();
  const docs = await getDocs();
  const timestamp = new Date();

  const emailSegment = intake.email.replace(/[^a-z0-9@._-]/gi, '_').toLowerCase();
  const dateSegment = `${timestamp.getUTCFullYear()}-${String(timestamp.getUTCMonth() + 1).padStart(2, '0')}-${String(
    timestamp.getUTCDate()
  ).padStart(2, '0')}`;

  const parent = await ensureFolder(drive, config.driveRootId, 'Fulfillment');
  const customerFolder = await ensureFolder(drive, parent.id!, emailSegment);
  const orderFolder = await ensureFolder(drive, customerFolder.id!, dateSegment);

  return {
    drive,
    docs,
    rootFolderId: config.driveRootId,
    orderFolderId: orderFolder.id!,
    orderFolderUrl: orderFolder.webViewLink || '',
    timestamp,
    config,
  };
}

export async function ensureFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<drive_v3.Schema$File> {
  const query = `mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parentId}' in parents and name = '${
    name.replace(/'/g, "\\'")
  }'`;
  const res = await drive.files.list({
    q: query,
    fields: 'files(id, name, webViewLink)',
    pageSize: 1,
  });
  const existing = res.data.files?.[0];
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id, name, webViewLink',
  });
  return created.data;
}

export async function appendFulfillmentLog(
  intake: NormalizedIntake,
  summary: OrderSummary,
  config: FulfillmentConfig
): Promise<void> {
  if (!config.sheetId) return;
  try {
    const sheets = await getSheets();
    const utc = new Date(summary.completedAt).toISOString();
    const local = new Date(summary.completedAt).toLocaleString('en-US', { timeZone: 'America/Denver' });
    const files = summary.files.join('\n');
    const fulfillmentType = summary.metadata?.fulfillment_type || intake.fulfillmentType || '';
    const metadataAddOns = summary.metadata?.add_ons;
    const addOns = Array.isArray(metadataAddOns)
      ? metadataAddOns.join(', ')
      : (intake.addOns || []).join(', ');
    const fulfillmentStatus = summary.metadata?.bundle_fulfillment || '';
    await appendRows(config.sheetId, 'Fulfillment!A2:J', [
      [
        utc,
        local,
        intake.email,
        intake.tier,
        summary.message,
        files,
        summary.status,
        fulfillmentType,
        addOns,
        fulfillmentStatus,
      ],
    ]);
  } catch (err) {
    console.warn('[fulfillment.log] failed to append to sheet:', err);
  }
}

export async function notifyOpsChannel(message: string, config: FulfillmentConfig): Promise<void> {
  if (!config.telegramChatId || !config.telegramBotToken) return;
  try {
    await tgSend(message, config.telegramChatId);
  } catch (err) {
    console.warn('[fulfillment.notify] failed to send telegram message:', err);
  }
}

export function summarizeStory(story: string, maxLength = 280): string {
  const clean = story.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trim()}…`;
}

export async function recordOrderSummary(summary: OrderSummary): Promise<void> {
  try {
    const { writeFile, mkdir } = await import('fs/promises');
    const filePath = path.resolve(process.cwd(), 'data');
    await mkdir(filePath, { recursive: true });
    await writeFile(path.join(filePath, 'last-fulfillment.json'), JSON.stringify(summary, null, 2));
  } catch {}
}

export type { IconLibraryEntry, SkuDefinition };
