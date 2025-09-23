import process from 'node:process';

import { google } from 'googleapis';

import { getConfigValue, putConfig } from '../lib/kv';
import { hydrateEnvFromThreadState } from './lib/threadState';

export interface HealthCheckResult {
  service: string;
  ok: boolean;
  detail: string;
  checkedAt: string;
  latencyMs?: number;
}

export interface HeartbeatStatus {
  lastRun: string;
  currentTask: string;
  lastHealthChecks: Record<string, HealthCheckResult>;
  nextRun: string;
  notes?: string[];
}

export interface RunFullAutonomyOptions {
  triggeredBy?: string;
  force?: boolean;
}

type EnvSnapshot = Record<string, string>;

const HEARTBEAT_KEY = 'status:last';
const PAUSE_KEY = 'autonomy:paused';

function nowISO(): string {
  return new Date().toISOString();
}

function limitDetail(detail: string, max = 220): string {
  const clean = detail.trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(normalized);
}

async function isAutonomyPaused(): Promise<boolean> {
  try {
    const raw = await getConfigValue<string>(PAUSE_KEY);
    if (typeof raw === 'string') {
      return parseBooleanFlag(raw);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/404/.test(message) && !/not found/i.test(message)) {
      console.warn('[full-autonomy] Unable to read autonomy pause flag:', message);
    }
  }
  return false;
}

function envValue(key: string, snapshot: EnvSnapshot): string | undefined {
  return process.env[key] ?? snapshot[key];
}

async function checkStripe(snapshot: EnvSnapshot): Promise<HealthCheckResult> {
  const started = Date.now();
  const key = envValue('STRIPE_SECRET_KEY', snapshot);
  const checkedAt = nowISO();
  if (!key) {
    return {
      service: 'stripe',
      ok: false,
      detail: 'Missing STRIPE_SECRET_KEY.',
      checkedAt,
    };
  }

  try {
    const res = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      const detail = limitDetail(`HTTP ${res.status}`);
      return {
        service: 'stripe',
        ok: false,
        detail,
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }
    return {
      service: 'stripe',
      ok: true,
      detail: `HTTP ${res.status}`,
      checkedAt,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      service: 'stripe',
      ok: false,
      detail: limitDetail(`Network error: ${message}`),
      checkedAt,
      latencyMs: Date.now() - started,
    };
  }
}

async function checkTally(snapshot: EnvSnapshot): Promise<HealthCheckResult> {
  const started = Date.now();
  const key = envValue('TALLY_API_KEY', snapshot);
  const checkedAt = nowISO();
  if (!key) {
    return {
      service: 'tally',
      ok: false,
      detail: 'Missing TALLY_API_KEY.',
      checkedAt,
    };
  }

  try {
    const res = await fetch('https://api.tally.so/forms', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      return {
        service: 'tally',
        ok: false,
        detail: `HTTP ${res.status}`,
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }
    return {
      service: 'tally',
      ok: true,
      detail: `HTTP ${res.status}`,
      checkedAt,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      service: 'tally',
      ok: false,
      detail: limitDetail(`Network error: ${message}`),
      checkedAt,
      latencyMs: Date.now() - started,
    };
  }
}

async function checkNotion(snapshot: EnvSnapshot): Promise<HealthCheckResult> {
  const started = Date.now();
  const token =
    envValue('NOTION_TOKEN', snapshot) || envValue('NOTION_API_KEY', snapshot);
  const checkedAt = nowISO();
  if (!token) {
    return {
      service: 'notion',
      ok: false,
      detail: 'Missing NOTION_TOKEN / NOTION_API_KEY.',
      checkedAt,
    };
  }

  try {
    const res = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
    });
    if (!res.ok) {
      return {
        service: 'notion',
        ok: false,
        detail: `HTTP ${res.status}`,
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }
    return {
      service: 'notion',
      ok: true,
      detail: `HTTP ${res.status}`,
      checkedAt,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      service: 'notion',
      ok: false,
      detail: limitDetail(`Network error: ${message}`),
      checkedAt,
      latencyMs: Date.now() - started,
    };
  }
}

async function checkDrive(snapshot: EnvSnapshot): Promise<HealthCheckResult> {
  const started = Date.now();
  const checkedAt = nowISO();
  const clientEmail = envValue('GOOGLE_CLIENT_EMAIL', snapshot);
  const rawKey = envValue('GOOGLE_PRIVATE_KEY', snapshot);

  if (!clientEmail || !rawKey) {
    return {
      service: 'drive',
      ok: false,
      detail: 'Missing Google service account credentials.',
      checkedAt,
    };
  }

  const privateKey = rawKey.includes('BEGIN PRIVATE KEY')
    ? rawKey.replace(/\\n/g, '\n')
    : rawKey;

  try {
    const auth = new google.auth.JWT(clientEmail, undefined, privateKey, [
      'https://www.googleapis.com/auth/drive.metadata.readonly',
    ]);
    await auth.authorize();
    const drive = google.drive({ version: 'v3', auth });
    await drive.files.list({ pageSize: 1, fields: 'files(id)' });
    return {
      service: 'drive',
      ok: true,
      detail: 'Service account authorized.',
      checkedAt,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      service: 'drive',
      ok: false,
      detail: limitDetail(`Drive error: ${message}`),
      checkedAt,
      latencyMs: Date.now() - started,
    };
  }
}

async function checkTikTok(snapshot: EnvSnapshot): Promise<HealthCheckResult> {
  const started = Date.now();
  const checkedAt = nowISO();
  const sessions = [
    envValue('TIKTOK_SESSION_MAGGIE', snapshot),
    envValue('TIKTOK_SESSION_MAIN', snapshot),
    envValue('TIKTOK_SESSION_WILLOW', snapshot),
    envValue('TIKTOK_SESSION_MARS', snapshot),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  const workerUrl =
    envValue('WORKER_URL', snapshot) || envValue('WORKER_BASE_URL', snapshot);
  const trimmedWorker = workerUrl ? workerUrl.replace(/\/$/, '') : '';

  if (trimmedWorker) {
    try {
      const res = await fetch(`${trimmedWorker}/tiktok/accounts`);
      if (res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const payload = await res.json().catch(() => null);
          const count = Array.isArray(payload)
            ? payload.length
            : Array.isArray(payload?.accounts)
              ? payload.accounts.length
              : null;
          if (typeof count === 'number') {
            detail += ` • ${count} account(s)`;
          }
        } catch {
          // Ignore JSON parse errors; detail already recorded.
        }
        return {
          service: 'tiktok',
          ok: true,
          detail,
          checkedAt,
          latencyMs: Date.now() - started,
        };
      }
      return {
        service: 'tiktok',
        ok: false,
        detail: `Worker HTTP ${res.status}`,
        checkedAt,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        service: 'tiktok',
        ok: false,
        detail: limitDetail(`Worker error: ${message}`),
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }
  }

  if (sessions.length) {
    return {
      service: 'tiktok',
      ok: true,
      detail: `Session cookies present (${sessions.length})`,
      checkedAt,
      latencyMs: Date.now() - started,
    };
  }

  return {
    service: 'tiktok',
    ok: false,
    detail: 'No TikTok session cookies loaded.',
    checkedAt,
    latencyMs: Date.now() - started,
  };
}

async function runHealthChecks(snapshot: EnvSnapshot): Promise<Record<string, HealthCheckResult>> {
  const results: Record<string, HealthCheckResult> = {};
  const tasks: [string, () => Promise<HealthCheckResult>][] = [
    ['stripe', () => checkStripe(snapshot)],
    ['tally', () => checkTally(snapshot)],
    ['tiktok', () => checkTikTok(snapshot)],
    ['notion', () => checkNotion(snapshot)],
    ['drive', () => checkDrive(snapshot)],
  ];

  for (const [service, runner] of tasks) {
    try {
      const result = await runner();
      results[service] = result;
      console.log(
        `[full-autonomy] ${service} health → ${result.ok ? 'ok' : 'fail'} :: ${result.detail}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results[service] = {
        service,
        ok: false,
        detail: limitDetail(`Health check crashed: ${message}`),
        checkedAt: nowISO(),
      };
      console.error(`[full-autonomy] ${service} health crashed:`, message);
    }
  }

  return results;
}

function computeNextRun(timestamp: Date): string {
  const fallbackMinutes = 30;
  const configured = Number.parseInt(process.env.AUTONOMY_INTERVAL_MINUTES || '', 10);
  const minutes = Number.isFinite(configured) && configured > 0 ? configured : fallbackMinutes;
  return new Date(timestamp.getTime() + minutes * 60_000).toISOString();
}

export async function runFullAutonomy(
  options: RunFullAutonomyOptions = {},
): Promise<HeartbeatStatus> {
  const startedAt = new Date();
  console.log('[full-autonomy] Starting autonomy cycle at', startedAt.toISOString());

  const snapshot = await hydrateEnvFromThreadState();
  const paused = !options.force && (await isAutonomyPaused());

  if (paused) {
    console.log('[full-autonomy] Autonomy paused via KV flag; skipping task execution.');
  }

  const health = await runHealthChecks(snapshot);

  // Placeholder for additional task orchestration if needed in future iterations.
  if (!paused) {
    console.log('[full-autonomy] No additional tasks configured for this cycle.');
  }

  const status: HeartbeatStatus = {
    lastRun: startedAt.toISOString(),
    currentTask: paused ? 'paused' : 'autonomy-cycle',
    lastHealthChecks: health,
    nextRun: computeNextRun(startedAt),
  };

  const notes: string[] = [];
  if (options.triggeredBy) notes.push(`triggeredBy:${options.triggeredBy}`);
  if (options.force) notes.push('forced');
  if (paused) notes.push('paused');
  if (notes.length) status.notes = notes;

  await putConfig(HEARTBEAT_KEY, status);
  console.log('[full-autonomy] Saved heartbeat payload to KV.', JSON.stringify(status, null, 2));

  return status;
}

async function runCli() {
  try {
    await runFullAutonomy({
      triggeredBy: process.env.GITHUB_WORKFLOW
        ? `workflow:${process.env.GITHUB_WORKFLOW}`
        : 'manual',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[full-autonomy] Fatal error:', message);
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(`file://${process.argv[1] ?? ''}`).href) {
  runCli();
}

