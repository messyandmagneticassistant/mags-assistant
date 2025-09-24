import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { getConfigValue, putConfig } from '../lib/kv';
import type { AutonomyRunLogEntry, AutonomyRunIssue, MaggieState } from '../shared/maggieState';
import { THREAD_STATE_KEY } from '../shared/maggieState';
import { computeQuietWindow, isWithinQuietHours, QUIET_TIMEZONE } from './lib/timeUtils';

export const STATUS_KV_KEY = 'status:last';
export const CONTROL_KV_KEY = 'autonomy:control';

export interface AutonomyControl {
  paused: boolean;
  reason?: string;
  pausedAt?: string | null;
  resumeAt?: string | null;
  updatedAt: string;
  requestedBy?: string;
}

interface ControlOptions {
  key?: string;
}

const DEFAULT_TASK = 'autonomy-loop';

const AUTONOMY_QUEUE_MARKER = '[auto]';
const AUTONOMY_TASK_SUFFIX = '(auto)';

interface FallbackQueueItem {
  queue: string;
  task: string;
}

const FALLBACK_QUEUE_ITEMS: FallbackQueueItem[] = [
  {
    queue: `Retry website deploy ${AUTONOMY_QUEUE_MARKER}`,
    task: `Retry website deploy ${AUTONOMY_TASK_SUFFIX}`,
  },
  {
    queue: `Scan support email inbox ${AUTONOMY_QUEUE_MARKER}`,
    task: `Scan support email inbox ${AUTONOMY_TASK_SUFFIX}`,
  },
  {
    queue: `Clean Drive staging area ${AUTONOMY_QUEUE_MARKER}`,
    task: `Clean Drive staging area ${AUTONOMY_TASK_SUFFIX}`,
  },
  {
    queue: `Refresh donor CRM follow-ups ${AUTONOMY_QUEUE_MARKER}`,
    task: `Refresh donor CRM follow-ups ${AUTONOMY_TASK_SUFFIX}`,
  },
  {
    queue: `Rebuild marketing performance digest ${AUTONOMY_QUEUE_MARKER}`,
    task: `Rebuild marketing performance digest ${AUTONOMY_TASK_SUFFIX}`,
  },
];

const CHECK_META = [
  { key: 'website', label: 'Website' },
  { key: 'stripe', label: 'Stripe' },
  { key: 'tally', label: 'Tally' },
  { key: 'social', label: 'Social' },
  { key: 'fileCleanup', label: 'File cleanup' },
  { key: 'marketing', label: 'Marketing' },
] as const;

type DefaultCheckKey = (typeof CHECK_META)[number]['key'];

const CHECK_ALIASES: Record<string, DefaultCheckKey> = {
  website: 'website',
  site: 'website',
  web: 'website',
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

function formatIso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function normalizeTasksList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed || /^idle$/i.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    normalized.push(trimmed);
    seen.add(trimmed);
  }
  return normalized;
}

function normalizeQueueList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    normalized.push(trimmed);
    seen.add(trimmed);
  }
  return normalized;
}

function normalizeTaskForComparison(value: string): string {
  return value
    .replace(/\(auto\)$/i, '')
    .replace(/\[auto\]$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function stripAutoSuffix(value: string): string {
  return value.replace(/\s*\(auto\)\s*$/i, '').trim();
}

function coerceCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isFallbackQueueItem(value: string): boolean {
  return value.includes(AUTONOMY_QUEUE_MARKER);
}

function isFallbackTaskItem(value: string): boolean {
  return value.toLowerCase().endsWith(AUTONOMY_TASK_SUFFIX);
}

function pushUnique(list: string[], value: string): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  if (!list.includes(trimmed)) {
    list.push(trimmed);
  }
}

function pickFallbackQueueItems(count: number, used: Set<string>): FallbackQueueItem[] {
  const results: FallbackQueueItem[] = [];
  const startIndex = Math.abs(Math.floor(Date.now() / (5 * 60 * 1000)));
  for (let offset = 0; offset < FALLBACK_QUEUE_ITEMS.length && results.length < count; offset += 1) {
    const candidate = FALLBACK_QUEUE_ITEMS[(startIndex + offset) % FALLBACK_QUEUE_ITEMS.length];
    const normalized = normalizeTaskForComparison(candidate.task);
    if (used.has(normalized)) {
      continue;
    }
    results.push(candidate);
    used.add(normalized);
  }
  if (!results.length) {
    results.push(FALLBACK_QUEUE_ITEMS[startIndex % FALLBACK_QUEUE_ITEMS.length]);
  }
  return results;
}

async function loadThreadStateSnapshot(): Promise<MaggieState> {
  try {
    const snapshot = await getConfigValue<MaggieState>(THREAD_STATE_KEY, { type: 'json' });
    if (snapshot && typeof snapshot === 'object') {
      return snapshot as MaggieState;
    }
  } catch (err) {
    console.warn('[fullAutonomy] Unable to load thread-state snapshot:', err);
  }
  return {};
}

function listsEqual(left: string[] | undefined, right: string[]): boolean {
  if (!Array.isArray(left)) {
    return right.length === 0;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

type ThreadStatePhase = 'start' | 'complete' | 'paused';

interface ThreadStateUpdateOptions {
  env: NodeJS.ProcessEnv;
  phase: ThreadStatePhase;
  checks: DefaultCheckKey[];
  startedAt: Date;
  control?: AutonomyControl | null;
  workerStatus?: any;
  status?: AutonomyStatus | null;
}

function cloneChecks(checks: AutonomyCheckResult[] | undefined): AutonomyCheckResult[] {
  if (!Array.isArray(checks)) return [];
  return checks.map((check) => ({ ...check }));
}

function mapIssues(
  checks: AutonomyCheckResult[] | undefined,
  match: AutonomyCheckState[],
): AutonomyRunIssue[] {
  if (!Array.isArray(checks) || !checks.length) return [];
  return checks
    .filter((check) => match.includes(check.state))
    .map(
      (check) =>
        ({
          key: check.key,
          label: check.label,
          detail: check.detail,
          state: check.state,
          critical: check.critical,
        }) satisfies AutonomyRunIssue,
    );
}

function createRunLogEntry(options: {
  status: AutonomyStatus | null;
  startedAt: Date;
  finishedAt: Date;
  fallbackQueued: string[];
}): AutonomyRunLogEntry {
  const checks = cloneChecks(options.status?.checks);
  const summaryText = options.status?.summary?.text ?? 'No checks recorded.';
  const ok = options.status?.summary?.ok ?? checks.every((check) => check.state !== 'fail');
  const critical = checks.some((check) => check.critical);
  const errors = mapIssues(checks, ['fail']);
  const warnings = mapIssues(checks, ['warn']);
  const quietWindow = computeQuietWindow(options.startedAt);

  return {
    startedAt: options.startedAt.toISOString(),
    finishedAt: options.finishedAt.toISOString(),
    durationMs: Math.max(0, options.finishedAt.getTime() - options.startedAt.getTime()),
    summary: summaryText,
    ok,
    critical,
    nextRun: options.status?.nextRun ?? null,
    actions: [...options.fallbackQueued],
    errors,
    warnings,
    checks,
    quiet: {
      start: quietWindow.start.toISOString(),
      end: quietWindow.end.toISOString(),
      inQuiet: isWithinQuietHours(options.startedAt),
      timeZone: QUIET_TIMEZONE,
    },
  } satisfies AutonomyRunLogEntry;
}

async function writeRunOutput(status: AutonomyStatus, entry: AutonomyRunLogEntry): Promise<void> {
  const outputPath = process.env.RUN_OUTPUT_PATH || 'run-output.json';
  const payload = {
    generatedAt: new Date().toISOString(),
    statusTimestamp: status.timestamp,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    durationMs: entry.durationMs ?? null,
    summary: entry.summary,
    ok: entry.ok ?? false,
    critical: entry.critical ?? false,
    nextRun: entry.nextRun ?? status.nextRun ?? null,
    actions: entry.actions ?? [],
    errors: entry.errors ?? [],
    warnings: entry.warnings ?? [],
    quiet: entry.quiet,
    checks: status.checks ?? [],
    status,
  };

  try {
    await fs.writeFile(path.resolve(process.cwd(), outputPath), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.warn('[fullAutonomy] Unable to write run-output file:', err);
  }
}

async function updateThreadStateActivity(
  options: ThreadStateUpdateOptions,
): Promise<{ fallbackQueued: string[]; updated: boolean; logEntry?: AutonomyRunLogEntry }> {
  const fallbackQueued: string[] = [];
  let logEntry: AutonomyRunLogEntry | undefined;

  try {
    const state = await loadThreadStateSnapshot();
    let tasks = normalizeTasksList(state.currentTasks).filter(
      (task) => !task.toLowerCase().startsWith('autonomy loop:'),
    );
    const scheduledExisting = normalizeQueueList(state.scheduledPosts);
    const flopExisting = normalizeQueueList(state.flopRetries);

    let scheduledNext = scheduledExisting;
    let flopNext = flopExisting;

    if (options.phase === 'complete') {
      const actualScheduled = scheduledExisting.filter((item) => !isFallbackQueueItem(item));
      const actualRetries = flopExisting.filter((item) => !isFallbackQueueItem(item));

      const queueScheduled =
        options.workerStatus?.socialQueue?.scheduled !== undefined
          ? coerceCount(options.workerStatus.socialQueue.scheduled)
          : null;
      const queueRetries =
        options.workerStatus?.socialQueue?.flopsRetry !== undefined
          ? coerceCount(options.workerStatus.socialQueue.flopsRetry)
          : null;

      const effectiveScheduled =
        queueScheduled === null
          ? actualScheduled.length
          : queueScheduled === 0
            ? actualScheduled.length
            : queueScheduled;
      const effectiveRetries =
        queueRetries === null
          ? actualRetries.length
          : queueRetries === 0
            ? actualRetries.length
            : queueRetries;

      tasks = tasks.filter((task) => !isFallbackTaskItem(task));

      if (effectiveScheduled === 0 && effectiveRetries === 0) {
        const used = new Set(tasks.map(normalizeTaskForComparison));
        const fallbackItems = pickFallbackQueueItems(2, used);
        if (fallbackItems.length) {
          scheduledNext = fallbackItems.map((item) => item.queue);
          flopNext = [];
          for (const item of fallbackItems) {
            pushUnique(tasks, item.task);
            fallbackQueued.push(stripAutoSuffix(item.task));
          }
        } else {
          scheduledNext = actualScheduled;
          flopNext = actualRetries;
        }
      } else {
        scheduledNext = actualScheduled;
        flopNext = actualRetries;
      }
    } else {
      tasks = tasks.filter((task) => !isFallbackTaskItem(task));
    }

    const usedAfterQueue = new Set(tasks.map(normalizeTaskForComparison));
    let label: string;
    if (options.phase === 'paused') {
      const reason = options.control?.reason?.trim();
      label = `Autonomy loop: paused${reason ? ` — ${reason}` : ''}`;
    } else if (options.phase === 'start') {
      const startedIso = formatIso(options.startedAt);
      const count = options.checks.length;
      label = `Autonomy loop: running ${count} check${count === 1 ? '' : 's'} (started ${startedIso})`;
    } else {
      const finishedIsoShort = formatIso(new Date());
      const count = options.checks.length;
      label = `Autonomy loop: completed ${count} check${count === 1 ? '' : 's'} at ${finishedIsoShort}`;
    }
    if (!usedAfterQueue.has(normalizeTaskForComparison(label))) {
      pushUnique(tasks, label);
    }

    const previousTasks = normalizeTasksList(state.currentTasks);
    const tasksChanged = !listsEqual(previousTasks, tasks);

    const nextState: MaggieState = {
      ...state,
      currentTasks: tasks,
    };

    let changed = tasksChanged;

    if (options.phase === 'complete') {
      const finishedAt = new Date();
      const finishedIso = finishedAt.toISOString();
      nextState.scheduledPosts = scheduledNext;
      nextState.flopRetries = flopNext;
      nextState.lastCheck = finishedIso;
      const autonomyMeta =
        (typeof state.autonomy === 'object' && state.autonomy !== null ? state.autonomy : {}) as Record<string, unknown>;
      logEntry = createRunLogEntry({
        status: options.status ?? null,
        startedAt: options.startedAt,
        finishedAt,
        fallbackQueued,
      });
      const previousHistory = Array.isArray((autonomyMeta as any).history)
        ? ((autonomyMeta as any).history as AutonomyRunLogEntry[])
        : [];
      const history = [logEntry, ...previousHistory].slice(0, 50);
      nextState.autonomy = {
        ...autonomyMeta,
        lastRunAt: finishedIso,
        lastStartedAt: options.startedAt.toISOString(),
        checks: options.checks,
        fallbackQueued,
        lastNextRun: options.status?.nextRun ?? null,
        lastSummary: logEntry.summary,
        lastDurationMs: logEntry.durationMs,
        lastCritical: logEntry.critical,
        lastActions: logEntry.actions,
        lastErrors: logEntry.errors,
        lastWarnings: logEntry.warnings,
        history,
        lastQuietWindow: logEntry.quiet,
      };
      const previousScheduled = normalizeQueueList(state.scheduledPosts);
      const previousRetries = normalizeQueueList(state.flopRetries);
      const scheduledChanged = !listsEqual(previousScheduled, scheduledNext);
      const retriesChanged = !listsEqual(previousRetries, flopNext);
      changed = true;
      if (!scheduledChanged && !retriesChanged && state.lastCheck === finishedIso && !tasksChanged) {
        // still changed due to new autonomy metadata
        changed = true;
      }
    } else if (options.phase === 'paused') {
      const autonomyMeta =
        (typeof state.autonomy === 'object' && state.autonomy !== null ? state.autonomy : {}) as Record<string, unknown>;
      nextState.autonomy = {
        ...autonomyMeta,
        pausedAt: options.control?.pausedAt ?? options.control?.updatedAt ?? new Date().toISOString(),
        pausedReason: options.control?.reason,
        lastNextRun: options.status?.nextRun ?? null,
      };
    }

    if (!changed) {
      return { fallbackQueued, updated: false, logEntry };
    }

    await putConfig(THREAD_STATE_KEY, nextState, { contentType: 'application/json' });
    console.log(
      `[fullAutonomy] Thread-state updated (${options.phase}) — tasks: ${nextState.currentTasks?.join(', ') ?? 'none'}`,
    );
    if (fallbackQueued.length) {
      console.log(`[fullAutonomy] Injected fallback queue item(s): ${fallbackQueued.join(', ')}`);
    }
    return { fallbackQueued, updated: true, logEntry };
  } catch (err) {
    console.warn('[fullAutonomy] Unable to update thread-state activity:', err);
    return { fallbackQueued, updated: false, logEntry };
  }
}

export type AutonomyCheckState = 'ok' | 'fail' | 'warn' | 'pending';

const CRITICAL_CHECKS = new Set<DefaultCheckKey>(['website', 'stripe', 'tally', 'marketing']);

function shouldMarkCritical(
  key: string,
  state: AutonomyCheckState,
  explicit?: boolean | null,
): boolean {
  if (typeof explicit === 'boolean') {
    return explicit;
  }
  if (state !== 'fail') {
    return false;
  }
  const resolved = resolveCheckKey(key) ?? (key as DefaultCheckKey | null);
  return resolved ? CRITICAL_CHECKS.has(resolved as DefaultCheckKey) : false;
}

export interface AutonomyCheckResult {
  key: string;
  label: string;
  state: AutonomyCheckState;
  detail?: string;
  ranAt: string | null;
  critical?: boolean;
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
      critical?: boolean;
    };

interface NormalizedCheckInput {
  key: string;
  label?: string;
  state?: AutonomyCheckState;
  detail?: string;
  ranAt?: string | null;
  critical?: boolean;
}

export type PartialAutonomyStatus = Partial<Omit<AutonomyStatus, 'summary' | 'checks'>> & {
  checks?: CheckInput[];
  summary?: Partial<AutonomySummary>;
};

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return undefined;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(trimmed)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(trimmed)) return false;
  }
  return undefined;
}

function coerceIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeControl(input: Partial<AutonomyControl> | null | undefined): AutonomyControl | null {
  if (!input) return null;
  const paused = normalizeBoolean(input.paused) ?? false;
  const now = new Date().toISOString();
  return {
    paused,
    reason: typeof input.reason === 'string' && input.reason.trim().length ? input.reason.trim() : undefined,
    pausedAt: coerceIsoDate(input.pausedAt) ?? (paused ? coerceIsoDate(input.updatedAt) : null),
    resumeAt: coerceIsoDate(input.resumeAt),
    updatedAt: coerceIsoDate(input.updatedAt) ?? now,
    requestedBy:
      typeof input.requestedBy === 'string' && input.requestedBy.trim().length
        ? input.requestedBy.trim()
        : undefined,
  } satisfies AutonomyControl;
}

export async function loadAutonomyControl(key = CONTROL_KV_KEY): Promise<AutonomyControl | null> {
  try {
    const data = await getConfigValue<AutonomyControl>(key, { type: 'json' });
    const normalized = normalizeControl(data);
    if (normalized) {
      return normalized;
    }
  } catch (err) {
    console.warn(`[fullAutonomy] Failed to load control state from ${key}:`, err);
  }

  const pausedEnv =
    normalizeBoolean(process.env.AUTONOMY_PAUSED) ?? normalizeBoolean(process.env.AUTONOMY_DISABLED);
  if (pausedEnv === undefined) {
    return null;
  }

  return {
    paused: pausedEnv,
    reason:
      typeof process.env.AUTONOMY_PAUSE_REASON === 'string'
        ? process.env.AUTONOMY_PAUSE_REASON.trim() || undefined
        : undefined,
    pausedAt: coerceIsoDate(process.env.AUTONOMY_PAUSED_AT) ?? null,
    resumeAt: coerceIsoDate(process.env.AUTONOMY_RESUME_AT),
    updatedAt: new Date().toISOString(),
    requestedBy:
      typeof process.env.AUTONOMY_REQUESTED_BY === 'string'
        ? process.env.AUTONOMY_REQUESTED_BY.trim() || undefined
        : undefined,
  } satisfies AutonomyControl;
}

export async function saveAutonomyControl(
  control: AutonomyControl,
  options: ControlOptions = {},
): Promise<void> {
  const normalized = normalizeControl(control) ?? {
    paused: false,
    updatedAt: new Date().toISOString(),
  };
  await putConfig(options.key ?? CONTROL_KV_KEY, normalized, { contentType: 'application/json' });
}

export function isAutonomyPaused(control: AutonomyControl | null | undefined): boolean {
  return !!(control && control.paused);
}

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
    const critical = normalizeBoolean((entry as any).critical);
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
      critical: critical === undefined ? undefined : critical,
    };
  }

  const candidate = resolveCheckKey((entry as any).name ?? (entry as any).label);
  if (!candidate) return null;
  const critical = normalizeBoolean((entry as any).critical);
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
    critical: critical === undefined ? undefined : critical,
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
        critical: item.critical ?? existing.critical,
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
    const critical = shouldMarkCritical(key, state, input.critical);
    return {
      key,
      label,
      state,
      detail: input.detail,
      ranAt,
      critical: critical ? true : undefined,
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
        critical: undefined,
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
  orchestrate: boolean;
  runChecks: string[];
  controlKey?: string;
  pause?: boolean;
  resume?: boolean;
  reason?: string;
  resumeAt?: string;
  requestedBy?: string;
  allowWhenPaused?: boolean;
  statusKey?: string;
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    inputPaths: [],
    fromEnv: false,
    checks: [],
    orchestrate: false,
    runChecks: [],
  };

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
    if (arg === '--run-check') {
      const value = argv[index + 1];
      if (value) {
        options.runChecks.push(value);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--run-check=')) {
      options.runChecks.push(arg.slice('--run-check='.length));
      continue;
    }
    if (arg === '--orchestrate' || arg === '--run') {
      options.orchestrate = true;
      continue;
    }
    if (arg === '--control-key') {
      const value = argv[index + 1];
      if (value) {
        options.controlKey = value;
        index += 1;
      }
      continue;
    }
    if (arg === '--status-key') {
      const value = argv[index + 1];
      if (value) {
        options.statusKey = value;
        index += 1;
      }
      continue;
    }
    if (arg === '--pause') {
      options.pause = true;
      continue;
    }
    if (arg === '--resume') {
      options.resume = true;
      continue;
    }
    if (arg === '--reason') {
      const value = argv[index + 1];
      if (value) {
        options.reason = value;
        index += 1;
      }
      continue;
    }
    if (arg === '--resume-at') {
      const value = argv[index + 1];
      if (value) {
        options.resumeAt = value;
        index += 1;
      }
      continue;
    }
    if (arg === '--requested-by') {
      const value = argv[index + 1];
      if (value) {
        options.requestedBy = value;
        index += 1;
      }
      continue;
    }
    if (arg === '--allow-when-paused' || arg === '--force') {
      options.allowWhenPaused = true;
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

interface TaskContext {
  env: NodeJS.ProcessEnv;
  control: AutonomyControl | null;
  startedAt: Date;
}

type TaskRunner = (context: TaskContext) => Promise<AutonomyCheckResult>;

function isoNow(): string {
  return new Date().toISOString();
}

function lookupLabel(key: string): string {
  const meta = CHECK_META.find((item) => item.key === key);
  return meta?.label ?? toTitleCase(key);
}

function createResult(
  key: DefaultCheckKey,
  state: AutonomyCheckState,
  detail?: string,
  ranAt?: string,
  critical?: boolean,
): AutonomyCheckResult {
  const normalizedDetail = detail && detail.trim().length ? detail.trim() : undefined;
  const ranTimestamp = ranAt ?? isoNow();
  const isCritical = shouldMarkCritical(key, state, critical);
  return {
    key,
    label: lookupLabel(key),
    state,
    detail: normalizedDetail,
    ranAt: ranTimestamp,
    critical: isCritical ? true : undefined,
  } satisfies AutonomyCheckResult;
}

function resolveWorkerUrl(env: NodeJS.ProcessEnv): string | null {
  const candidate =
    env.WORKER_URL || env.WORKER_BASE_URL || env.WORKER_ENDPOINT || env.MAGS_WORKER_URL || env.MAGGIE_WORKER_URL;
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (!trimmed.length) return null;
  return trimmed.replace(/\/$/, '');
}

async function fetchWorkerJson(
  env: NodeJS.ProcessEnv,
  pathName: string,
  init: RequestInit = {},
): Promise<any> {
  const base = resolveWorkerUrl(env);
  if (!base) {
    throw new Error('WORKER_URL not configured');
  }
  const url = `${base}${pathName.startsWith('/') ? pathName : `/${pathName}`}`;
  const headers = new Headers(init.headers ?? {});
  const authToken =
    env.WORKER_KEY || env.POST_THREAD_SECRET || env.MAGGIE_WORKER_KEY || env.CF_WORKER_KEY || env.AUTONOMY_WORKER_KEY;
  if (authToken && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${authToken}`);
  }
  if (!headers.has('content-type') && init.body) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}${text ? ` ${text}` : ''}`);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchWorkerStatusSnapshot(env: NodeJS.ProcessEnv): Promise<any | null> {
  try {
    return await fetchWorkerJson(env, '/status');
  } catch (err) {
    console.warn('[fullAutonomy] Unable to fetch worker /status snapshot:', err);
    return null;
  }
}

async function runWebsiteCheck(context: TaskContext): Promise<AutonomyCheckResult> {
  const key: DefaultCheckKey = 'website';
  const candidate =
    context.env.WEBSITE_URL ||
    context.env.SITE_URL ||
    context.env.WEBSITE_BASE_URL ||
    context.env.WEBSITE ||
    'https://messyandmagnetic.com';
  const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
  if (!trimmed) {
    return createResult(key, 'warn', 'WEBSITE_URL not configured.');
  }
  const target = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(target, { method: 'GET', signal: controller.signal });
    if (!response.ok) {
      const critical = response.status >= 500;
      return createResult(key, critical ? 'fail' : 'warn', `HTTP ${response.status}`, undefined, critical);
    }
    const server = response.headers.get('server');
    const cache = response.headers.get('cache-control');
    const detailParts = [`HTTP ${response.status}`];
    if (server) detailParts.push(server);
    if (cache) detailParts.push(cache.split(',')[0]);
    return createResult(key, 'ok', detailParts.join(' • '));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return createResult(key, 'fail', message);
  } finally {
    clearTimeout(timeout);
  }
}

async function runStripeCheck(context: TaskContext): Promise<AutonomyCheckResult> {
  const key: DefaultCheckKey = 'stripe';
  const secret =
    context.env.STRIPE_SECRET_KEY || context.env.STRIPE_API_KEY || context.env.STRIPE_SECRET || context.env.STRIPE_TOKEN;
  if (!secret) {
    return createResult(key, 'warn', 'STRIPE_SECRET_KEY not configured');
  }

  try {
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(secret, { apiVersion: '2023-10-16' });
    const products = await stripe.products.list({ limit: 5 });
    const prices = await stripe.prices.list({ limit: 5 });
    const detail = `Fetched ${products.data.length} product(s), ${prices.data.length} price(s).`;
    return createResult(key, 'ok', detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lowered = message.toLowerCase();
    const state: AutonomyCheckState = lowered.includes('secret') || lowered.includes('api key') ? 'fail' : 'warn';
    return createResult(key, state, message);
  }
}

async function runTallyCheck(context: TaskContext): Promise<AutonomyCheckResult> {
  const key: DefaultCheckKey = 'tally';
  const details: string[] = [];
  let state: AutonomyCheckState | null = null;

  const workerUrl = resolveWorkerUrl(context.env);
  if (workerUrl) {
    try {
      const payload = await fetchWorkerJson(context.env, '/ops/recent-order');
      if (payload?.ok && payload.summary) {
        const createdAt = payload.summary.createdAt || payload.summary.created_at || payload.summary.created_at_iso;
        const when = coerceIsoTimestamp(createdAt ?? null);
        if (when) {
          details.push(`Recent intake at ${when}`);
        } else {
          details.push('Recent intake summary available.');
        }
        state = 'ok';
      } else {
        details.push('No recent intake summary found.');
        state = state ?? 'warn';
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      details.push(`Worker check failed: ${message}`);
      state = state ?? 'warn';
    }
  }

  if (!state || state === 'warn') {
    const apiKey =
      context.env.TALLY_API_KEY ||
      context.env.TALLY_API_TOKEN ||
      context.env.TALLY_SECRET_MAIN ||
      context.env.TALLY_SIGNING_SECRET;
    if (!apiKey) {
      if (!state) state = 'warn';
      details.push('TALLY_API_KEY not configured.');
    } else {
      try {
        const response = await fetch('https://api.tally.so/api/v1/forms', {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });
        if (response.ok) {
          const data = await response.json().catch(() => ({}));
          const forms = Array.isArray(data?.data) ? data.data.length : undefined;
          details.push(forms !== undefined ? `API reachable (${forms} form(s)).` : 'Tally API reachable.');
          state = state === 'warn' ? 'warn' : 'ok';
        } else if (response.status === 401 || response.status === 403) {
          details.push('Tally API rejected credentials.');
          state = 'fail';
        } else {
          details.push(`Tally API HTTP ${response.status}.`);
          state = state ?? 'warn';
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        details.push(`Tally API error: ${message}`);
        state = state ?? 'warn';
      }
    }
  }

  return createResult(key, state ?? 'warn', details.join(' '));
}

async function runSocialCheck(context: TaskContext): Promise<AutonomyCheckResult> {
  const key: DefaultCheckKey = 'social';
  const workerUrl = resolveWorkerUrl(context.env);
  if (!workerUrl) {
    return createResult(key, 'warn', 'WORKER_URL not configured.');
  }

  try {
    const status = await fetchWorkerJson(context.env, '/admin/status');
    if (!status || status.ok === false) {
      return createResult(key, 'warn', 'Worker status endpoint returned no data.');
    }
    const segments: string[] = [];
    if (typeof status.queueSize === 'number') {
      segments.push(`Queue ${status.queueSize}`);
    }
    if (typeof status.trendsAgeMinutes === 'number') {
      segments.push(`Trends ${status.trendsAgeMinutes}m old`);
    }
    if (typeof status.accountsCount === 'number') {
      segments.push(`Accounts ${status.accountsCount}`);
    }
    const detail = segments.length ? segments.join(', ') : 'Worker status healthy.';
    return createResult(key, 'ok', detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return createResult(key, 'warn', `Worker status check failed: ${message}`);
  }
}

const CLEANUP_EXTENSIONS = new Set(['.tmp', '.log', '.zip', '.mp4', '.mov', '.mkv', '.mp3', '.json']);
const CLEANUP_SKIP = new Set(['social-autopilot-queue.json']);

async function cleanupDirectory(target: string, maxAgeMs: number): Promise<number> {
  const entries = await fs
    .readdir(target, { withFileTypes: true })
    .catch(() => [] as Dirent[]);
  const now = Date.now();
  let removed = 0;

  for (const entry of entries) {
    const fullPath = path.join(target, entry.name);
    if (CLEANUP_SKIP.has(entry.name)) {
      continue;
    }
    try {
      const stats = await fs.stat(fullPath);
      const age = now - stats.mtimeMs;
      if (entry.isDirectory()) {
        removed += await cleanupDirectory(fullPath, maxAgeMs);
        const leftover = await fs.readdir(fullPath).catch(() => []);
        if (!leftover.length && age > maxAgeMs) {
          await fs.rm(fullPath, { recursive: true, force: true });
        }
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      const threshold = CLEANUP_EXTENSIONS.has(ext) ? Math.min(maxAgeMs, 12 * 60 * 60 * 1000) : maxAgeMs;
      if (age > threshold) {
        await fs.rm(fullPath, { force: true });
        removed += 1;
      }
    } catch (err) {
      console.warn('[fullAutonomy] Unable to cleanup', fullPath, err);
    }
  }

  return removed;
}

async function runFileCleanup(context: TaskContext): Promise<AutonomyCheckResult> {
  const key: DefaultCheckKey = 'fileCleanup';
  const ttlMs = Number(context.env.AUTONOMY_FILE_TTL_MS ?? 48 * 60 * 60 * 1000);
  const root = path.join(process.cwd(), 'work');

  try {
    const removed = await cleanupDirectory(root, ttlMs);
    const detail = removed ? `Removed ${removed} stale file(s).` : 'No stale files detected.';
    return createResult(key, 'ok', detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return createResult(key, 'warn', `Cleanup failed: ${message}`);
  }
}

async function runMarketingCheck(context: TaskContext): Promise<AutonomyCheckResult> {
  const key: DefaultCheckKey = 'marketing';
  const token = context.env.NOTION_API_KEY || context.env.NOTION_TOKEN || context.env.NOTION_SECRET;
  const pageId =
    context.env.NOTION_DONOR_PAGE_ID ||
    context.env.NOTION_PAGE_ID ||
    context.env.NOTION_DONOR_PAGE ||
    context.env.NOTION_DONOR_DATABASE_ID;

  if (!token || !pageId) {
    return createResult(key, 'warn', 'Notion credentials not configured.');
  }

  const notionVersion = context.env.NOTION_VERSION || '2022-06-28';
  const trimmedId = pageId.trim();
  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${trimmedId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': notionVersion,
      },
    });
    if (!res.ok) {
      const detail = `Notion HTTP ${res.status}`;
      const state: AutonomyCheckState = res.status === 404 ? 'fail' : 'warn';
      return createResult(key, state, detail);
    }
    const payload = await res.json().catch(() => ({}));
    const edited = payload?.last_edited_time ? new Date(payload.last_edited_time) : null;
    if (!edited || Number.isNaN(edited.getTime())) {
      return createResult(key, 'warn', 'Notion page lacks last_edited_time.');
    }
    const ageHours = Math.round((Date.now() - edited.getTime()) / (1000 * 60 * 60));
    const detail = `Updated ${edited.toISOString().slice(0, 16)}Z (${ageHours}h ago).`;
    const state: AutonomyCheckState = ageHours <= 72 ? 'ok' : 'warn';
    return createResult(key, state, detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return createResult(key, 'warn', `Notion error: ${message}`);
  }
}

const CHECK_RUNNERS: Record<DefaultCheckKey, TaskRunner> = {
  website: runWebsiteCheck,
  stripe: runStripeCheck,
  tally: runTallyCheck,
  social: runSocialCheck,
  fileCleanup: runFileCleanup,
  marketing: runMarketingCheck,
};

interface OrchestrateOptions {
  controlKey?: string;
  statusKey?: string;
  runChecks?: string[];
  allowWhenPaused?: boolean;
  checkOverrides?: CheckInput[];
  task?: string;
  timestamp?: string;
  nextRun?: string;
}

async function orchestrateAutonomy(options: OrchestrateOptions): Promise<AutonomyStatus> {
  const env = process.env;
  const control = await loadAutonomyControl(options.controlKey ?? CONTROL_KV_KEY);
  const paused = isAutonomyPaused(control) && !options.allowWhenPaused;
  const startedAt = new Date();

  const requestedKeys = options.runChecks && options.runChecks.length ? options.runChecks : CHECK_META.map((c) => c.key);
  const normalizedKeys = Array.from(
    new Set(
      requestedKeys
        .map((key) => resolveCheckKey(key))
        .filter((key): key is DefaultCheckKey => !!key && CHECK_META.some((meta) => meta.key === key)),
    ),
  );

  const results: CheckInput[] = [];

  await updateThreadStateActivity({
    env,
    phase: paused ? 'paused' : 'start',
    checks: normalizedKeys,
    startedAt,
    control,
  });

  let workerStatus: any | null = null;

  if (!paused) {
    for (const key of normalizedKeys) {
      const runner = CHECK_RUNNERS[key];
      if (!runner) {
        results.push({ key, state: 'pending', detail: 'No runner available.' });
        continue;
      }
      try {
        const result = await runner({ env, control, startedAt });
        console.log(
          `[fullAutonomy] ${result.label}: ${result.state}${result.detail ? ` — ${result.detail}` : ''}`,
        );
        results.push({
          key: result.key,
          label: result.label,
          state: result.state,
          detail: result.detail,
          ranAt: result.ranAt,
          critical: result.critical,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[fullAutonomy] ${lookupLabel(key)} failed:`, message);
        results.push({
          key,
          state: 'fail',
          detail: message,
          ranAt: isoNow(),
          critical: shouldMarkCritical(key, 'fail'),
        });
      }
    }

    workerStatus = await fetchWorkerStatusSnapshot(env);
  } else {
    const pausedDetail = control?.reason ? `Paused: ${control.reason}` : 'Autonomy paused';
    for (const key of normalizedKeys) {
      results.push({
        key,
        label: lookupLabel(key),
        state: 'pending',
        detail: pausedDetail,
        ranAt: control?.pausedAt ?? isoNow(),
      });
    }
  }

  const overrides = options.checkOverrides?.length ? options.checkOverrides : undefined;
  const timestamp = coerceIsoTimestamp(options.timestamp ?? null) ?? isoNow();
  const nextRun = coerceIsoTimestamp(options.nextRun ?? null)
    ?? (paused ? control?.resumeAt ?? null : new Date(Date.now() + 5 * 60 * 1000).toISOString());

  const baseStatus: PartialAutonomyStatus = {
    timestamp,
    currentTask: paused
      ? 'paused'
      : options.task ?? `${DEFAULT_TASK} (${normalizedKeys.length} check${normalizedKeys.length === 1 ? '' : 's'})`,
    nextRun,
    checks: results,
  };

  const merged = overrides ? coerceStatusInput([baseStatus, { checks: overrides }]) : coerceStatusInput([baseStatus]);
  const status = await saveAutonomyStatus(merged, { key: options.statusKey ?? STATUS_KV_KEY });
  console.log(
    `[fullAutonomy] Autonomy ${paused ? 'heartbeat (paused)' : 'run'} complete. Summary: ${status.summary.text}`,
  );

  const activity = await updateThreadStateActivity({
    env,
    phase: paused ? 'paused' : 'complete',
    checks: normalizedKeys,
    startedAt,
    control,
    workerStatus,
    status,
  });
  const finishedAt = status.timestamp ? new Date(status.timestamp) : new Date();
  const logEntry =
    activity.logEntry ??
    createRunLogEntry({
      status,
      startedAt,
      finishedAt: Number.isNaN(finishedAt.getTime()) ? new Date() : finishedAt,
      fallbackQueued: activity.fallbackQueued,
    });
  await writeRunOutput(status, logEntry);

  return status;
}

async function applyControlUpdate(options: CliOptions): Promise<AutonomyControl | null> {
  if (!options.pause && !options.resume && !options.reason && !options.resumeAt && !options.requestedBy) {
    return null;
  }

  const current = await loadAutonomyControl(options.controlKey ?? CONTROL_KV_KEY);
  const nextPaused = options.pause ? true : options.resume ? false : current?.paused ?? false;
  const timestamp = isoNow();
  const next: AutonomyControl = {
    paused: nextPaused,
    reason: options.reason ?? current?.reason,
    pausedAt: nextPaused ? (current?.pausedAt ?? timestamp) : null,
    resumeAt: coerceIsoTimestamp(options.resumeAt ?? null) ?? (nextPaused ? current?.resumeAt ?? null : null),
    updatedAt: timestamp,
    requestedBy: options.requestedBy ?? current?.requestedBy,
  };

  await saveAutonomyControl(next, { key: options.controlKey });
  console.log(
    `[fullAutonomy] Autonomy ${next.paused ? 'paused' : 'resumed'}${next.reason ? ` — ${next.reason}` : ''}.`,
  );
  return next;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const control = await applyControlUpdate(options);

  const shouldDefaultToOrchestrate =
    !options.orchestrate &&
    options.inputPaths.length === 0 &&
    !options.fromEnv &&
    !options.pause &&
    !options.resume &&
    !options.reason &&
    !options.resumeAt &&
    !options.timestamp &&
    !options.nextRun &&
    options.runChecks.length === 0 &&
    options.checks.length === 0 &&
    (!options.task || options.task === DEFAULT_TASK) &&
    (process.env.AUTONOMY_TASK || '').trim() === 'full-autonomy';

  if (shouldDefaultToOrchestrate) {
    options.orchestrate = true;
  }

  if (options.orchestrate) {
    await orchestrateAutonomy({
      controlKey: options.controlKey,
      statusKey: options.statusKey,
      runChecks: options.runChecks,
      allowWhenPaused: options.allowWhenPaused,
      checkOverrides: options.checks,
      task: options.task,
      timestamp: options.timestamp,
      nextRun: options.nextRun ?? options.resumeAt,
    });
    return;
  }

  const parts = await gatherStatusParts(options);

  if (control) {
    if (control.paused) {
      const pauseDetail = control.reason ? `Paused: ${control.reason}` : 'Autonomy paused';
      parts.push({
        currentTask: 'paused',
        timestamp: control.updatedAt,
        nextRun: control.resumeAt ?? null,
        checks: CHECK_META.map((meta) => ({
          key: meta.key,
          state: 'pending',
          detail: pauseDetail,
          ranAt: control.pausedAt ?? control.updatedAt,
        })),
      });
    } else {
      parts.push({
        currentTask: options.task ?? DEFAULT_TASK,
        timestamp: control.updatedAt,
        nextRun: options.nextRun ?? null,
      });
    }
  }

  const merged = parts.length ? coerceStatusInput(parts) : {};
  const status = await saveAutonomyStatus(merged, { key: options.statusKey ?? STATUS_KV_KEY });
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

