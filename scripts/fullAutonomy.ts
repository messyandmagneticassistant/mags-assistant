import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { getConfigValue, putConfig } from '../lib/kv';

export const STATUS_KV_KEY = 'status:last';

const DEFAULT_TASK = 'autonomy-loop';

const CHECK_META = [
  { key: 'stripe', label: 'Stripe' },
  { key: 'tally', label: 'Tally' },
  { key: 'social', label: 'Social' },
  { key: 'fileCleanup', label: 'File cleanup' },
  { key: 'marketing', label: 'Marketing' },
] as const;

type DefaultCheckKey = (typeof CHECK_META)[number]['key'];

const CHECK_ALIASES: Record<string, DefaultCheckKey> = {
  stripe: 'stripe',
  stripeaudit: 'stripe',
  tally: 'tally',
  tallysync: 'tally',
  social: 'social',
  socialautopilot: 'social',
  autopilot: 'social',
  engagement: 'social',
  filecleanup: 'fileCleanup',
  cleanup: 'fileCleanup',
  files: 'fileCleanup',
  marketing: 'marketing',
  growth: 'marketing',
};

export type AutonomyCheckState = 'ok' | 'fail' | 'warn' | 'pending';

export interface AutonomyCheckResult {
  key: string;
  label: string;
  state: AutonomyCheckState;
  detail?: string;
  ranAt: string | null;
}

export interface AutonomySummary {
  ok: boolean;
  successes: number;
  failures: number;
  warnings: number;
  pending: number;
  text: string;
}

export interface AutonomyStatus {
  timestamp: string;
  currentTask: string;
  nextRun: string | null;
  checks: AutonomyCheckResult[];
  summary: AutonomySummary;
}

type CheckInput =
  | string
  | null
  | undefined
  | Partial<AutonomyCheckResult>
  | {
      key?: string;
      name?: string;
      label?: string;
      state?: string;
      status?: string;
      detail?: string;
      message?: string;
      ranAt?: string;
      timestamp?: string;
    };

interface NormalizedCheckInput {
  key: string;
  label?: string;
  state?: AutonomyCheckState;
  detail?: string;
  ranAt?: string | null;
}

export type PartialAutonomyStatus = Partial<Omit<AutonomyStatus, 'summary' | 'checks'>> & {
  checks?: CheckInput[];
  summary?: Partial<AutonomySummary>;
};

const CHECK_STATE_ALIASES: Record<string, AutonomyCheckState> = {
  ok: 'ok',
  success: 'ok',
  pass: 'ok',
  passed: 'ok',
  good: 'ok',
  done: 'ok',
  fail: 'fail',
  failed: 'fail',
  error: 'fail',
  crashed: 'fail',
  warn: 'warn',
  warning: 'warn',
  degraded: 'warn',
  partial: 'warn',
  pending: 'pending',
  queued: 'pending',
  todo: 'pending',
  skip: 'pending',
  skipped: 'pending',
};

function resolveCheckKey(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (!compact) return null;
  return CHECK_ALIASES[compact] ?? compact;
}

function toTitleCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(\w)(.*)$/g, (_, first: string, rest: string) => `${first.toUpperCase()}${rest.toLowerCase()}`);
}

function iconForState(state: AutonomyCheckState): string {
  switch (state) {
    case 'ok':
      return '✅';
    case 'fail':
      return '❌';
    case 'warn':
      return '⚠️';
    default:
      return '⏳';
  }
}

function parseState(raw: string | undefined): AutonomyCheckState | undefined {
  if (!raw) return undefined;
  const key = raw.trim().toLowerCase();
  return CHECK_STATE_ALIASES[key];
}

function coerceIsoTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function coerceCheckInput(entry: CheckInput): NormalizedCheckInput | null {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const match = entry.trim();
    if (!match) return null;
    const token = match
      .replace(/=>/, ':')
      .replace(/=/g, ':');
    const [rawKey, rawState, ...detailParts] = token.split(':');
    const key = resolveCheckKey(rawKey);
    if (!key) return null;
    const state = parseState(rawState);
    const detail = detailParts.length ? detailParts.join(':').trim() || undefined : undefined;
    return { key, state, detail };
  }

  if (typeof entry !== 'object') return null;

  if ('key' in entry && typeof entry.key === 'string') {
    const key = resolveCheckKey(entry.key) ?? resolveCheckKey(entry.label ?? entry.name ?? undefined);
    if (!key) return null;
    return {
      key,
      label: typeof entry.label === 'string' ? entry.label : undefined,
      state: parseState((entry as any).state ?? (entry as any).status),
      detail:
        typeof entry.detail === 'string'
          ? entry.detail
          : typeof (entry as any).message === 'string'
            ? (entry as any).message
            : undefined,
      ranAt: coerceIsoTimestamp((entry as any).ranAt ?? (entry as any).timestamp ?? null),
    };
  }

  const candidate = resolveCheckKey((entry as any).name ?? (entry as any).label);
  if (!candidate) return null;
  return {
    key: candidate,
    label: typeof (entry as any).label === 'string' ? (entry as any).label : undefined,
    state: parseState((entry as any).state ?? (entry as any).status),
    detail:
      typeof (entry as any).detail === 'string'
        ? (entry as any).detail
        : typeof (entry as any).message === 'string'
          ? (entry as any).message
          : undefined,
    ranAt: coerceIsoTimestamp((entry as any).ranAt ?? (entry as any).timestamp ?? null),
  };
}

function mergeCheckInputs(parts: NormalizedCheckInput[][]): NormalizedCheckInput[] {
  const map = new Map<string, NormalizedCheckInput>();
  for (const list of parts) {
    for (const item of list) {
      if (!item || !item.key) continue;
      const existing = map.get(item.key) ?? { key: item.key };
      map.set(item.key, {
        key: item.key,
        label: item.label ?? existing.label,
        state: item.state ?? existing.state,
        detail: item.detail ?? existing.detail,
        ranAt: item.ranAt ?? existing.ranAt,
      });
    }
  }
  return [...map.values()];
}

function ensureCheckOrder(checks: NormalizedCheckInput[], fallbackTimestamp: string): AutonomyCheckResult[] {
  const entries = checks.map((input) => {
    const key = resolveCheckKey(input.key) ?? input.key;
    const meta = CHECK_META.find((item) => item.key === key);
    const label = input.label ?? meta?.label ?? toTitleCase(key);
    const state = input.state ?? 'pending';
    const ranAt =
      input.ranAt ?? (state === 'pending' ? null : coerceIsoTimestamp(fallbackTimestamp));
    return {
      key,
      label,
      state,
      detail: input.detail,
      ranAt,
    } satisfies AutonomyCheckResult;
  });

  const lookup = new Map(entries.map((entry) => [entry.key, entry]));
  const ordered: AutonomyCheckResult[] = [];
  for (const meta of CHECK_META) {
    const existing = lookup.get(meta.key);
    if (existing) {
      ordered.push(existing);
      lookup.delete(meta.key);
    } else {
      ordered.push({
        key: meta.key,
        label: meta.label,
        state: 'pending',
        detail: undefined,
        ranAt: null,
      });
    }
  }
  for (const value of lookup.values()) {
    ordered.push(value);
  }
  return ordered;
}

function buildSummary(checks: AutonomyCheckResult[]): AutonomySummary {
  const counts = { ok: 0, fail: 0, warn: 0, pending: 0 } as Record<AutonomyCheckState, number>;
  for (const check of checks) {
    counts[check.state] = (counts[check.state] ?? 0) + 1;
  }
  const text = checks.length
    ? checks.map((check) => `${iconForState(check.state)} ${check.label}`).join(', ')
    : 'No checks recorded';
  return {
    ok: counts.fail === 0,
    successes: counts.ok,
    failures: counts.fail,
    warnings: counts.warn,
    pending: counts.pending,
    text,
  };
}

function coerceStatusInput(input: PartialAutonomyStatus[]): PartialAutonomyStatus {
  const parts = input.filter((part): part is PartialAutonomyStatus => !!part);
  const result: PartialAutonomyStatus = {};
  const checkParts: NormalizedCheckInput[][] = [];

  for (const part of parts) {
    if (!part) continue;
    if (part.timestamp) result.timestamp = part.timestamp;
    if (part.currentTask) result.currentTask = part.currentTask;
    if (part.nextRun !== undefined) result.nextRun = part.nextRun;
    if (Array.isArray(part.checks)) {
      const normalized = part.checks
        .map(coerceCheckInput)
        .filter((value): value is NormalizedCheckInput => !!value);
      if (normalized.length) {
        checkParts.push(normalized);
      }
    }
  }

  if (checkParts.length) {
    result.checks = mergeCheckInputs(checkParts);
  }

  return result;
}

function normalizeStatus(partial: PartialAutonomyStatus): AutonomyStatus {
  const timestamp = coerceIsoTimestamp(partial.timestamp ?? null) ?? new Date().toISOString();
  const currentTask = partial.currentTask?.trim().length ? partial.currentTask.trim() : DEFAULT_TASK;
  const nextRun = coerceIsoTimestamp(partial.nextRun ?? null);
  const rawChecks = Array.isArray(partial.checks)
    ? partial.checks.map(coerceCheckInput).filter((value): value is NormalizedCheckInput => !!value)
    : [];
  const checks = ensureCheckOrder(rawChecks, timestamp);
  const summary = buildSummary(checks);
  return {
    timestamp,
    currentTask,
    nextRun: nextRun ?? null,
    checks,
    summary,
  };
}

export async function saveAutonomyStatus(
  partial: PartialAutonomyStatus,
  options: { key?: string } = {},
): Promise<AutonomyStatus> {
  const normalized = normalizeStatus(partial);
  const key = options.key ?? STATUS_KV_KEY;
  await putConfig(key, normalized, { contentType: 'application/json' });
  return normalized;
}

export async function loadAutonomyStatus(key = STATUS_KV_KEY): Promise<AutonomyStatus | null> {
  try {
    const data = await getConfigValue<AutonomyStatus>(key, { type: 'json' });
    if (!data || typeof data !== 'object') return null;
    return normalizeStatus(data as PartialAutonomyStatus);
  } catch (err) {
    console.warn(`[fullAutonomy] Failed to load status from ${key}:`, err);
    return null;
  }
}

async function readJsonFile(filePath: string): Promise<PartialAutonomyStatus | null> {
  try {
    const resolved = path.resolve(process.cwd(), filePath);
    const raw = await fs.readFile(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as PartialAutonomyStatus;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn(`[fullAutonomy] Unable to read status file ${filePath}:`, err);
    }
    return null;
  }
}

async function loadFromEnv(env: NodeJS.ProcessEnv): Promise<PartialAutonomyStatus | null> {
  const part: PartialAutonomyStatus = {};
  let hasData = false;

  if (env.AUTONOMY_TASK && env.AUTONOMY_TASK.trim().length) {
    part.currentTask = env.AUTONOMY_TASK.trim();
    hasData = true;
  }
  if (env.AUTONOMY_TIMESTAMP && env.AUTONOMY_TIMESTAMP.trim().length) {
    part.timestamp = env.AUTONOMY_TIMESTAMP.trim();
    hasData = true;
  } else if (env.AUTONOMY_LAST_RUN && env.AUTONOMY_LAST_RUN.trim().length) {
    part.timestamp = env.AUTONOMY_LAST_RUN.trim();
    hasData = true;
  }
  if (env.AUTONOMY_NEXT_RUN && env.AUTONOMY_NEXT_RUN.trim().length) {
    part.nextRun = env.AUTONOMY_NEXT_RUN.trim();
    hasData = true;
  }

  const checksEnv = env.AUTONOMY_CHECKS || env.AUTONOMY_STATUS_CHECKS;
  if (checksEnv) {
    const tokens = checksEnv
      .split(/[,;\n]+/)
      .map((token) => token.trim())
      .filter(Boolean);
    if (tokens.length) {
      part.checks = tokens;
      hasData = true;
    }
  }

  const fileCandidates = [env.AUTONOMY_STATUS_PATH, env.AUTONOMY_STATUS_FILE, 'autonomy-status.json'];
  for (const candidate of fileCandidates) {
    if (!candidate || !candidate.trim().length) continue;
    const fromFile = await readJsonFile(candidate.trim());
    if (fromFile) {
      return coerceStatusInput([fromFile, part]);
    }
  }

  return hasData ? part : null;
}

interface CliOptions {
  inputPaths: string[];
  fromEnv: boolean;
  task?: string;
  timestamp?: string;
  nextRun?: string;
  checks: CheckInput[];
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { inputPaths: [], fromEnv: false, checks: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input' || arg === '--status-file') {
      const value = argv[index + 1];
      if (value) {
        options.inputPaths.push(value);
        index += 1;
      }
      continue;
    }
    if (arg === '--from-env') {
      options.fromEnv = true;
      continue;
    }
    if (arg === '--task' || arg === '--current-task') {
      const value = argv[index + 1];
      if (value) {
        options.task = value;
        index += 1;
      }
      continue;
    }
    if (arg === '--timestamp') {
      const value = argv[index + 1];
      if (value) {
        options.timestamp = value;
        index += 1;
      }
      continue;
    }
    if (arg === '--next-run') {
      const value = argv[index + 1];
      if (value) {
        options.nextRun = value;
        index += 1;
      }
      continue;
    }
    if (arg === '--check') {
      const value = argv[index + 1];
      if (value) {
        options.checks.push(value);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--check=')) {
      options.checks.push(arg.slice('--check='.length));
      continue;
    }
  }

  return options;
}

async function gatherStatusParts(options: CliOptions): Promise<PartialAutonomyStatus[]> {
  const parts: PartialAutonomyStatus[] = [];

  for (const inputPath of options.inputPaths) {
    const fromFile = await readJsonFile(inputPath);
    if (fromFile) {
      parts.push(fromFile);
    }
  }

  if (options.fromEnv) {
    const envPart = await loadFromEnv(process.env);
    if (envPart) {
      parts.push(envPart);
    }
  }

  const overrides: PartialAutonomyStatus = {};
  if (options.task) overrides.currentTask = options.task;
  if (options.timestamp) overrides.timestamp = options.timestamp;
  if (options.nextRun) overrides.nextRun = options.nextRun;
  if (options.checks.length) overrides.checks = options.checks;

  if (Object.keys(overrides).length) {
    parts.push(overrides);
  }

  if (!parts.length) {
    const envPart = await loadFromEnv(process.env);
    if (envPart) {
      parts.push(envPart);
    }
  }

  return parts;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const parts = await gatherStatusParts(options);
  const merged = parts.length ? coerceStatusInput(parts) : {};
  const status = await saveAutonomyStatus(merged);
  console.log(
    `[fullAutonomy] Saved status for task "${status.currentTask}" at ${status.timestamp}. Summary: ${status.summary.text}`,
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('[fullAutonomy] Fatal error while updating status:', err);
    process.exitCode = 1;
  });
}

