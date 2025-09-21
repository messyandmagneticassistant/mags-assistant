import { promises as fs } from 'fs';
import path from 'path';

import { putConfig } from '../lib/kv';
import { loadBrainConfig } from '../maggie.config';

interface BrainState extends Record<string, unknown> {
  lastUpdated?: string;
  lastSynced?: string | null;
}

type SyncStatus = 'prepared' | 'success' | 'failed';

interface BrainSyncLog {
  status: SyncStatus;
  attemptedAt: string;
  key: string;
  bytes: number;
  source: string;
  trigger?: string;
  error?: string;
  skipReason?: string;
}

const KV_KEY = 'PostQ:thread-state';

function normalizeValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return undefined;
}

function readBooleanEnv(name: string | undefined): boolean {
  if (!name) return false;
  const value = name.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

async function writeLog(entry: BrainSyncLog) {
  const logPath = path.resolve(process.cwd(), 'brain-status.log');
  try {
    await fs.writeFile(logPath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.warn('[updateBrain] Unable to persist brain-status.log:', err);
  }
}

async function run() {
  const kvPath = path.resolve(process.cwd(), 'config', 'kv-state.json');
  let payload: BrainState;

  try {
    const raw = await fs.readFile(kvPath, 'utf8');
    payload = JSON.parse(raw) as BrainState;
  } catch (err) {
    console.error(`Failed to read or parse ${kvPath}.`);
    console.error(err);
    await writeLog({
      status: 'failed',
      attemptedAt: new Date().toISOString(),
      key: KV_KEY,
      bytes: 0,
      source: 'update-brain',
      trigger: process.env.GITHUB_EVENT_NAME,
      error: `read-error: ${(err as Error)?.message ?? String(err)}`,
    });
    process.exit(1);
    return;
  }

  const timestamp = new Date().toISOString();
  payload.lastUpdated = timestamp;
  payload.lastSynced = timestamp;

  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  try {
    await fs.writeFile(kvPath, serialized, 'utf8');
  } catch (err) {
    console.warn(`Failed to persist updated timestamp to ${kvPath}.`, err);
  }

  const bytes = Buffer.from(serialized).length;
  const source = process.env.GITHUB_WORKFLOW ? 'github-actions' : 'local';
  const trigger = process.env.GITHUB_EVENT_NAME;

  const skipDirectKv = readBooleanEnv(process.env.BRAIN_SYNC_SKIP_DIRECT_KV);
  let status: SyncStatus = skipDirectKv ? 'prepared' : 'success';
  let errorMessage: string | undefined;
  let skipReason: string | undefined;

  if (skipDirectKv) {
    skipReason = 'BRAIN_SYNC_SKIP_DIRECT_KV enabled; relying on external writer.';
    console.log('[updateBrain] Skipping direct Cloudflare KV write.');
  }

  if (!skipDirectKv) {
    let cloudflareConfig: Record<string, unknown> = {};
    try {
      cloudflareConfig = (await loadBrainConfig()) ?? {};
    } catch (err) {
      console.warn(
        'Unable to load brain config for Cloudflare credentials, falling back to env.',
        err
      );
    }

    const accountId =
      normalizeValue(cloudflareConfig.cloudflareAccountId) ||
      normalizeValue(cloudflareConfig.accountId) ||
      normalizeValue(process.env.CLOUDFLARE_ACCOUNT_ID) ||
      normalizeValue(process.env.CF_ACCOUNT_ID) ||
      normalizeValue(process.env.ACCOUNT_ID);
    const apiToken =
      normalizeValue(cloudflareConfig.cloudflareApiToken) ||
      normalizeValue(cloudflareConfig.apiToken) ||
      normalizeValue(process.env.CLOUDFLARE_API_TOKEN) ||
      normalizeValue(process.env.CF_API_TOKEN) ||
      normalizeValue(process.env.API_TOKEN);
    const namespaceId =
      normalizeValue(cloudflareConfig.kvNamespaceId) ||
      normalizeValue(cloudflareConfig.cloudflareKvNamespaceId) ||
      normalizeValue(cloudflareConfig.namespaceId) ||
      normalizeValue(process.env.CF_KV_POSTQ_NAMESPACE_ID) ||
      normalizeValue(process.env.CF_KV_NAMESPACE_ID);

    try {
      await putConfig(KV_KEY, payload, {
        accountId,
        apiToken,
        namespaceId,
        contentType: 'application/json',
      });
      console.log(
        `✅ Synced ${KV_KEY} from config/kv-state.json to Cloudflare KV at ${timestamp}.`
      );
    } catch (err) {
      status = 'failed';
      if (err instanceof Error) {
        errorMessage = err.message;
        if (err.message.includes('credentials')) {
          console.error(
            '❌ Failed to sync Maggie brain config. Missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, or CF_KV_POSTQ_NAMESPACE_ID?'
          );
        } else {
          console.error('❌ Failed to sync Maggie brain config to Cloudflare KV.');
          console.error(err.message);
        }
      } else {
        errorMessage = String(err);
        console.error('❌ Failed to sync Maggie brain config to Cloudflare KV.');
        console.error(err);
      }
    }
  }

  const logEntry: BrainSyncLog = {
    status,
    attemptedAt: timestamp,
    key: KV_KEY,
    bytes,
    source,
    trigger,
    error: errorMessage,
    skipReason,
  };

  await writeLog(logEntry);

  if (status === 'failed') {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('❌ Unexpected error while syncing Maggie brain config.');
  console.error(err);
  const fallback: BrainSyncLog = {
    status: 'failed',
    attemptedAt: new Date().toISOString(),
    key: KV_KEY,
    bytes: 0,
    source: process.env.GITHUB_WORKFLOW ? 'github-actions' : 'local',
    trigger: process.env.GITHUB_EVENT_NAME,
    error: err instanceof Error ? err.message : String(err),
  };
  writeLog(fallback).finally(() => {
    process.exit(1);
  });
});
