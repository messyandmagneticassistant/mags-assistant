import { promises as fs } from 'fs';
import path from 'path';

export type BrainSyncResult = 'success' | 'fail' | 'pending';

export interface BrainSyncStatus {
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  status?: BrainSyncResult;
  trigger?: string;
  source?: string;
  kvKey?: string;
  sizeBytes?: number;
  error?: string | null;
}

export interface PuppeteerStatus {
  lastRunAt?: string;
  status?: 'success' | 'fail';
  attempts?: number;
  error?: string | null;
  fallbackModel?: string | null;
  recoveryNotes?: string | null;
}

export interface WebhookStatus {
  lastSuccessAt?: string;
  lastFailureAt?: string;
  error?: string | null;
  attemptedRecovery?: string | null;
}

export interface MaggieStatusStore {
  brainSync?: BrainSyncStatus;
  puppeteer?: PuppeteerStatus;
  webhooks?: {
    stripe?: WebhookStatus;
    tally?: WebhookStatus;
  };
  lastUpdatedAt?: string;
}

const STATUS_PATH = path.resolve(process.cwd(), 'data', 'maggie-status.json');

async function ensureDirExists(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function readStatusFile(): Promise<MaggieStatusStore> {
  try {
    const raw = await fs.readFile(STATUS_PATH, 'utf8');
    return raw ? (JSON.parse(raw) as MaggieStatusStore) : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = result[key];
    if (isRecord(existing) && isRecord(value)) {
      result[key] = mergeDeep(existing, value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

async function writeStatusFile(data: MaggieStatusStore): Promise<MaggieStatusStore> {
  await ensureDirExists(STATUS_PATH);
  const next: MaggieStatusStore = {
    ...data,
    lastUpdatedAt: new Date().toISOString(),
  };
  await fs.writeFile(STATUS_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export async function getStatus(): Promise<MaggieStatusStore> {
  return readStatusFile();
}

export async function updateStatus(patch: Partial<MaggieStatusStore>): Promise<MaggieStatusStore> {
  const current = await readStatusFile();
  const merged = mergeDeep(current, patch as MaggieStatusStore);
  return writeStatusFile(merged);
}

export async function updateBrainStatus(patch: Partial<BrainSyncStatus>): Promise<MaggieStatusStore> {
  const normalized: BrainSyncStatus = {
    ...(patch || {}),
  };
  if (normalized.error === undefined) {
    normalized.error = undefined;
  }
  const nextPatch: Partial<MaggieStatusStore> = {
    brainSync: normalized,
  };
  return updateStatus(nextPatch);
}

export async function updatePuppeteerStatus(patch: Partial<PuppeteerStatus>): Promise<MaggieStatusStore> {
  const normalized: PuppeteerStatus = {
    ...(patch || {}),
  };
  if (normalized.error === undefined) {
    normalized.error = undefined;
  }
  const nextPatch: Partial<MaggieStatusStore> = { puppeteer: normalized };
  return updateStatus(nextPatch);
}

export async function updateWebhookStatus(
  kind: 'stripe' | 'tally',
  patch: Partial<WebhookStatus>
): Promise<MaggieStatusStore> {
  const normalized: WebhookStatus = {
    ...(patch || {}),
  };
  if (normalized.error === undefined) {
    normalized.error = undefined;
  }
  const current = await readStatusFile();
  const next: MaggieStatusStore = mergeDeep(current, {
    webhooks: {
      ...(current.webhooks || {}),
      [kind]: normalized,
    },
  } as MaggieStatusStore);
  return writeStatusFile(next);
}

export function getStatusFilePath(): string {
  return STATUS_PATH;
}
