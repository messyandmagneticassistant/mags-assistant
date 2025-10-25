import { promises as fs } from 'fs';
import path from 'path';

import { readBrain } from '../brain/readBrain';
import { putConfig } from '../lib/kv';
import { logBrainSyncToSheet, logErrorToSheet } from '../lib/maggieLogs';
import { updateBrainStatus } from '../lib/statusStore';
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
const COOLDOWN_MINUTES = Number.parseInt(
  process.env.BRAIN_SYNC_COOLDOWN_MINUTES || '15',
  10
);
const COOLDOWN_MS = Number.isFinite(COOLDOWN_MINUTES)
  ? Math.max(COOLDOWN_MINUTES, 0) * 60_000
  : 0;
const LOG_PATH = path.resolve(process.cwd(), 'brain-status.log');

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
  try {
    await fs.writeFile(LOG_PATH, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.warn('[updateBrain] Unable to persist brain-status.log:', err);
  }
}

async function readLastLog(): Promise<BrainSyncLog | null> {
  try {
    const raw = await fs.readFile(LOG_PATH, 'utf8');
    const data = JSON.parse(raw) as BrainSyncLog;
    if (data && typeof data === 'object') {
      return data;
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.warn('[updateBrain] Unable to read brain-status.log:', err);
    }
  }
  return null;
}

async function run() {
  const brainJsonPath = path.resolve(process.cwd(), 'brain', 'brain.json');
  let payload: BrainState;

  if (COOLDOWN_MS > 0) {
    const lastLog = await readLastLog();
    if (lastLog?.attemptedAt) {
      const lastTs = Date.parse(lastLog.attemptedAt);
      if (!Number.isNaN(lastTs)) {
        const now = Date.now();
        if (now - lastTs < COOLDOWN_MS) {
          const skipReason = `cooldown-active:${COOLDOWN_MINUTES}m`;
          const attemptedAt = new Date(now).toISOString();
          const entry: BrainSyncLog = {
            status: 'prepared',
            attemptedAt,
            key: KV_KEY,
            bytes: 0,
            source: process.env.GITHUB_WORKFLOW ? 'github-actions' : 'local',
            trigger: process.env.GITHUB_EVENT_NAME,
            skipReason,
          };
          await Promise.all([
            writeLog(entry),
            logBrainSyncToSheet({
              kvKey: KV_KEY,
              status: 'success',
              trigger: entry.trigger,
              source: entry.source,
              timestamp: attemptedAt,
              error: skipReason,
            }),
            updateBrainStatus({
              lastAttemptAt: attemptedAt,
              status: 'pending',
              trigger: entry.trigger,
              source: entry.source,
              kvKey: KV_KEY,
              sizeBytes: 0,
              error: skipReason,
            }),
          ]);
          console.log('[updateBrain] Cooldown active; skipping Cloudflare sync.');
          return;
        }
      }
    }
  }

  try {
    payload = (await readBrain()) as BrainState;
  } catch (err) {
    console.error('Failed to read brain document.');
    console.error(err);
    const entry: BrainSyncLog = {
      status: 'failed',
      attemptedAt: new Date().toISOString(),
      key: KV_KEY,
      bytes: 0,
      source: 'update-brain',
      trigger: process.env.GITHUB_EVENT_NAME,
      error: `read-error: ${(err as Error)?.message ?? String(err)}`,
    };
    await Promise.all([
      writeLog(entry),
      logBrainSyncToSheet({
        kvKey: KV_KEY,
        status: 'fail',
        trigger: entry.trigger,
        source: entry.source,
        timestamp: entry.attemptedAt,
        error: entry.error,
      }),
      updateBrainStatus({
        lastAttemptAt: entry.attemptedAt,
        lastFailureAt: entry.attemptedAt,
        status: 'fail',
        trigger: entry.trigger,
        source: entry.source,
        kvKey: KV_KEY,
        sizeBytes: 0,
        error: entry.error,
      }),
      logErrorToSheet({
        module: 'BrainSync',
        error: entry.error,
        recovery: 'read brain failed',
        timestamp: entry.attemptedAt,
      }),
    ]);
    process.exit(1);
    return;
  }

  const timestamp = new Date().toISOString();
  const basePayload: BrainState = {
    ...payload,
    lastUpdated: timestamp,
  };
  if (typeof basePayload.notes === 'string') {
    basePayload.notes = basePayload.notes.trim();
  }

  let outboundPayload: BrainState = {
    ...basePayload,
    lastSynced: timestamp,
  };

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
      normalizeValue(cloudflareConfig.cloudflareToken) ||
      normalizeValue(cloudflareConfig.token) ||
      normalizeValue(cloudflareConfig.workerToken) ||
      normalizeValue(cloudflareConfig.postqToken) ||
      normalizeValue(cloudflareConfig.kvToken) ||
      normalizeValue(process.env.CLOUDFLARE_API_TOKEN) ||
      normalizeValue(process.env.CLOUDFLARE_TOKEN) ||
      normalizeValue(process.env.CF_API_TOKEN) ||
      normalizeValue(process.env.API_TOKEN);
    const namespaceId =
      normalizeValue(cloudflareConfig.kvNamespaceId) ||
      normalizeValue(cloudflareConfig.cloudflareKvNamespaceId) ||
      normalizeValue(cloudflareConfig.namespaceId) ||
      normalizeValue((cloudflareConfig.kv as Record<string, unknown> | undefined)?.namespaceId) ||
      normalizeValue((cloudflareConfig.kv as Record<string, unknown> | undefined)?.id) ||
      normalizeValue(process.env.CF_KV_POSTQ_NAMESPACE_ID) ||
      normalizeValue(process.env.CF_KV_NAMESPACE_ID) ||
      normalizeValue(process.env.CLOUDFLARE_KV_POSTQ_NAMESPACE_ID);

    let snapshotError: string | null = null;
    try {
      await putConfig(KV_KEY, outboundPayload, {
        accountId,
        apiToken,
        namespaceId,
        contentType: 'application/json',
      });
      console.log(
        `✅ Synced ${KV_KEY} from brain/brain.json to Cloudflare KV at ${timestamp}.`
      );

      try {
        await putConfig('brain/latest', outboundPayload, {
          accountId,
          apiToken,
          namespaceId,
          contentType: 'application/json',
        });
        console.log('[updateBrain] Synced brain/latest snapshot to Cloudflare KV.');
      } catch (err) {
        snapshotError = err instanceof Error ? err.message : String(err);
        console.error('[updateBrain] Failed to sync brain/latest snapshot to Cloudflare KV.');
        console.error(snapshotError);
      }
    } catch (err) {
      status = 'failed';
      if (err instanceof Error) {
        errorMessage = err.message;
        if (err.message.includes('credentials')) {
          console.error(
            '❌ Failed to sync Maggie brain config. Missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (or CLOUDFLARE_TOKEN), or CF_KV_POSTQ_NAMESPACE_ID?'
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

    if (snapshotError) {
      status = 'failed';
      const message = `brain/latest: ${snapshotError}`;
      errorMessage = errorMessage ? `${errorMessage}; ${message}` : message;
    }
  }

  const finalPayload: BrainState =
    status === 'success'
      ? outboundPayload
      : {
          ...basePayload,
          lastSynced: payload.lastSynced ?? null,
        };

  const serialized = `${JSON.stringify(finalPayload, null, 2)}\n`;
  const bytes = Buffer.from(serialized).length;

  try {
    await fs.writeFile(brainJsonPath, serialized, 'utf8');
  } catch (err) {
    console.warn(`Failed to refresh ${brainJsonPath}:`, err);
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

  const sheetStatus = status === 'failed' ? 'fail' : status === 'prepared' ? 'success' : status;
  const syncStatus =
    status === 'failed' ? 'fail' : status === 'prepared' ? 'pending' : 'success';

  await Promise.all([
    writeLog(logEntry),
    logBrainSyncToSheet({
      kvKey: KV_KEY,
      status: sheetStatus,
      trigger,
      source,
      timestamp,
      error: errorMessage ?? skipReason,
    }),
    updateBrainStatus({
      lastAttemptAt: timestamp,
      lastSuccessAt: syncStatus === 'success' ? timestamp : undefined,
      lastFailureAt: syncStatus === 'fail' ? timestamp : undefined,
      status: syncStatus,
      trigger,
      source,
      kvKey: KV_KEY,
      sizeBytes: bytes,
      error: errorMessage,
    }),
    status === 'failed'
      ? logErrorToSheet({
          module: 'BrainSync',
          error: errorMessage || 'Brain sync failed',
          recovery: skipReason,
          timestamp,
        })
      : Promise.resolve(),
  ]);

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
  Promise.all([
    writeLog(fallback),
    logBrainSyncToSheet({
      kvKey: KV_KEY,
      status: 'fail',
      trigger: fallback.trigger,
      source: fallback.source,
      timestamp: fallback.attemptedAt,
      error: fallback.error,
    }),
    updateBrainStatus({
      lastAttemptAt: fallback.attemptedAt,
      lastFailureAt: fallback.attemptedAt,
      status: 'fail',
      trigger: fallback.trigger,
      source: fallback.source,
      kvKey: KV_KEY,
      sizeBytes: 0,
      error: fallback.error,
    }),
    logErrorToSheet({
      module: 'BrainSync',
      error: fallback.error,
      recovery: 'unhandled',
      timestamp: fallback.attemptedAt,
    }),
  ]).finally(() => {
    process.exit(1);
  });
});
