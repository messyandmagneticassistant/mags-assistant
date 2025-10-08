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

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === 'string') return [value];
  return [];
}

function formatList(items: string[], prefix = '-'): string[] {
  return items.map((item) => `${prefix} ${item}`);
}

function renderBrainDoc(payload: BrainState, timestamp: string): string {
  const lines: string[] = ['# Maggie Brain Snapshot', ''];
  lines.push(`> Auto-synced from [\`brain/brain.md\`](../brain/brain.md) at ${timestamp}.`, '');

  const profile = (payload.profile ?? {}) as Record<string, unknown>;
  if (Object.keys(profile).length) {
    lines.push('## Profile');
    if (profile.name) lines.push(`- **Name:** ${String(profile.name)}`);
    if (profile.role) lines.push(`- **Role:** ${String(profile.role)}`);
    const subs = Array.isArray(profile.subdomains)
      ? (profile.subdomains as string[])
      : [];
    if (subs.length) {
      lines.push('- **Subdomains:**');
      lines.push(...formatList(subs, '  -'));
    }
    if (profile.kvNamespace) {
      lines.push(`- **KV namespace:** ${String(profile.kvNamespace)}`);
    }
    lines.push('');
  }

  const logic = (payload.maggieLogic ?? {}) as Record<string, unknown>;
  if (Object.keys(logic).length) {
    lines.push('## Maggie Logic');
    const daily = asArray(logic.dailyLoop);
    if (daily.length) {
      lines.push('- **Daily loop:**');
      lines.push(...formatList(daily, '  -'));
    }
    const sync = asArray(logic.syncRoutine);
    if (sync.length) {
      lines.push('- **Sync routine:**');
      lines.push(...formatList(sync, '  -'));
    }
    lines.push('');
  }

  const soul = (payload.soulBlueprint ?? {}) as Record<string, unknown>;
  if (Object.keys(soul).length) {
    lines.push('## Soul Blueprint');
    const principles = asArray(soul.guidingPrinciples);
    if (principles.length) {
      lines.push('- **Guiding principles:**');
      lines.push(...formatList(principles, '  -'));
    }
    const focus = asArray(soul.focusAreas);
    if (focus.length) {
      lines.push('- **Focus areas:**');
      lines.push(...formatList(focus, '  -'));
    }
    lines.push('');
  }

  const services = (payload.services ?? {}) as Record<string, unknown>;
  const automation = (payload.automation ?? {}) as Record<string, unknown>;
  if (Object.keys(services).length || Object.keys(automation).length) {
    lines.push('## Operations');
    if (Object.keys(services).length) {
      lines.push('- **Services online:**');
      lines.push(
        ...formatList(
          Object.entries(services)
            .filter(([, value]) => Boolean(value))
            .map(([key]) => key),
          '  -'
        )
      );
    }
    if (Object.keys(automation).length) {
      lines.push('- **Automations active:**');
      lines.push(
        ...formatList(
          Object.entries(automation)
            .filter(([, value]) => Boolean(value))
            .map(([key]) => key),
          '  -'
        )
      );
    }
    lines.push('');
  }

  const threadState = (payload.threadState ?? {}) as Record<string, unknown>;
  if (Object.keys(threadState).length) {
    lines.push('## Thread State Sync');
    if (threadState.kvKey) lines.push(`- **KV key:** \`${String(threadState.kvKey)}\``);
    if (threadState.workerSubdomain)
      lines.push(`- **Worker:** \`${String(threadState.workerSubdomain)}\``);
    if (threadState.workflow) lines.push(`- **GitHub Action:** ${String(threadState.workflow)}`);
    if (threadState.cron) lines.push(`- **Cron cadence:** ${String(threadState.cron)}`);
    lines.push('');
  }

  const integrations = (payload.integrations ?? {}) as Record<string, unknown>;
  if (Object.keys(integrations).length) {
    lines.push('## Integrations');
    lines.push(
      ...formatList(
        Object.entries(integrations)
          .filter(([, value]) => Boolean(value))
          .map(([key]) => key),
        '-'
      )
    );
    lines.push('');
  }

  const notes = payload.notes;
  if (notes) {
    lines.push('## Notes');
    const noteLines = Array.isArray(notes)
      ? (notes as unknown[]).map((entry) => String(entry))
      : String(notes).split(/\r?\n/);
    lines.push(...formatList(noteLines.filter(Boolean), '-'));
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

async function run() {
  const kvPath = path.resolve(process.cwd(), 'config', 'kv-state.json');
  const brainJsonPath = path.resolve(process.cwd(), 'brain', 'brain.json');
  const brainDocPath = path.resolve(process.cwd(), 'docs', 'brain.md');
  let payload: BrainState;

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
  payload.lastUpdated = timestamp;
  payload.lastSynced = timestamp;
  if (typeof payload.notes === 'string') {
    payload.notes = payload.notes.trim();
  }

  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  await Promise.all([
    (async () => {
      try {
        await fs.writeFile(kvPath, serialized, 'utf8');
      } catch (err) {
        console.warn(`Failed to persist updated timestamp to ${kvPath}.`, err);
      }
    })(),
    (async () => {
      try {
        await fs.writeFile(brainJsonPath, serialized, 'utf8');
      } catch (err) {
        console.warn(`Failed to refresh ${brainJsonPath}:`, err);
      }
    })(),
    (async () => {
      try {
        await fs.mkdir(path.dirname(brainDocPath), { recursive: true });
        await fs.writeFile(brainDocPath, renderBrainDoc(payload, timestamp), 'utf8');
      } catch (err) {
        console.warn(`Failed to render ${brainDocPath}:`, err);
      }
    })(),
  ]);

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
        `✅ Synced ${KV_KEY} from brain/brain.md to Cloudflare KV at ${timestamp}.`
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
