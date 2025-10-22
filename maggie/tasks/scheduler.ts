import { readTasks, writeTasks, type Task } from '../../lib/task.js';
import { runTaskQueue } from '../../lib/codex.js';
import { postNextVideo } from './post-next.js';
import { tgSend } from '../../lib/telegram.js';
import { formatTask } from '../../lib/helpers/formatTask.js';

const MIN_INTERVAL_MS = 60_000;
const DEFAULT_INTERVAL_MS = Math.max(
  MIN_INTERVAL_MS,
  parseInt(process.env.POST_INTERVAL_MS || '180000', 10)
);
const DEFAULT_INITIAL_DELAY_MS = Math.max(
  0,
  parseInt(process.env.POST_INITIAL_DELAY_MS || '0', 10)
);

let schedulerTimer: NodeJS.Timeout | null = null;
let isProcessing = false;
let nextRunAtISO: string | null = null;
let lastRunAtISO: string | null = null;
let lastErrorMessage: string | null = null;
let runCount = 0;

async function processCodexTasks(): Promise<void> {
  let tasks: Task[] = [];

  try {
    tasks = await readTasks();
  } catch (err) {
    console.warn('[scheduler] Unable to read tasks.json:', err);
    return;
  }

  if (!tasks.length) {
    console.log('[scheduler] 📭 No queued Codex tasks.');
    return;
  }

  for (const task of tasks) {
    try {
      console.log(formatTask(task));
      const result = await runTaskQueue(task);

      task.metadata = {
        ...(task.metadata || {}),
        lastRun: new Date().toISOString(),
        result: result?.slice?.(0, 500) || '[no result or truncated]',
      };

      console.log(`✅ Codex task complete: ${task.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`❌ Codex task error "${task.name}":`, message);
    }
  }

  try {
    await writeTasks(tasks);
  } catch (err) {
    console.warn('[scheduler] Unable to persist updated tasks.json:', err);
  }

  console.log('✅ All Codex tasks processed.\n');
}

async function runPostCycle(): Promise<void> {
  console.log('[scheduler] 📹 Checking for next video to post...');

  try {
    const result = await postNextVideo();

    if (result?.success) {
      const title = result.title ?? 'unknown';
      console.log(`[scheduler] ✅ Posted: ${title}`);
      await tgSend(`✅ Maggie posted:\n<b>${title}</b>`).catch(() => undefined);
    } else {
      console.warn('[scheduler] ⚠️ Nothing to post right now.');
      await tgSend('⚠️ Maggie found nothing to post. Will retry.').catch(() => undefined);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[scheduler] ❌ Error during post cycle:', message);
    await tgSend(`❌ Maggie post error:\n<code>${message}</code>`).catch(() => undefined);
    throw err;
  }
}

async function runSchedulerCycle(trigger: string): Promise<void> {
  if (isProcessing) {
    console.log(`[scheduler] Cycle already running; skipping trigger "${trigger}".`);
    return;
  }

  isProcessing = true;
  console.log(`[scheduler] ▶️ Cycle start (${trigger}).`);

  try {
    await processCodexTasks();
    await runPostCycle();
    lastErrorMessage = null;
  } catch (err) {
    lastErrorMessage = err instanceof Error ? err.message : String(err);
    console.error('[scheduler] Cycle failed:', lastErrorMessage);
  } finally {
    isProcessing = false;
    lastRunAtISO = new Date().toISOString();
    runCount += 1;
    console.log('[scheduler] ◀️ Cycle complete.');
  }
}

function normalizeDelayMs(delayMs?: number): number {
  if (!Number.isFinite(delayMs)) return DEFAULT_INTERVAL_MS;
  const value = Number(delayMs);
  if (Number.isNaN(value)) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, value);
}

function planNextCycle(delayMs?: number): void {
  const delay = delayMs === undefined ? DEFAULT_INTERVAL_MS : normalizeDelayMs(delayMs);

  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }

  const targetTs = Date.now() + delay;
  nextRunAtISO = new Date(targetTs).toISOString();

  schedulerTimer = setTimeout(async () => {
    schedulerTimer = null;
    await runSchedulerCycle('timer').catch((err) => {
      console.error('[scheduler] Timer cycle error:', err instanceof Error ? err.message : String(err));
    });
    planNextCycle();
  }, delay);

  console.log(
    `[scheduler] ⏱️ Next cycle scheduled for ${nextRunAtISO} (in ${Math.round(delay / 1000)}s).`
  );
}

export interface SchedulerStatus {
  active: boolean;
  pending: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  runCount: number;
  lastError: string | null;
}

export function getSchedulerStatus(): SchedulerStatus {
  return {
    active: Boolean(schedulerTimer) || isProcessing,
    pending: isProcessing,
    nextRunAt: nextRunAtISO,
    lastRunAt: lastRunAtISO,
    runCount,
    lastError: lastErrorMessage,
  };
}

export async function scheduleNextPost(delayMs?: number): Promise<SchedulerStatus> {
  planNextCycle(delayMs);
  return getSchedulerStatus();
}

export function ensureSchedulerLoop(): SchedulerStatus {
  if (!schedulerTimer && !isProcessing) {
    planNextCycle(DEFAULT_INITIAL_DELAY_MS);
  }
  return getSchedulerStatus();
}

export async function runFullScheduler(options: { immediate?: boolean } = {}): Promise<SchedulerStatus> {
  const { immediate = true } = options;

  if (immediate) {
    await runSchedulerCycle('manual').catch((err) => {
      console.error('[scheduler] Manual cycle failed:', err instanceof Error ? err.message : String(err));
    });
  }

  return ensureSchedulerLoop();
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  isProcessing = false;
  console.log('[scheduler] ⏹️ Scheduler stopped.');
}

// 🧪 Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runFullScheduler().catch((err) => {
    console.error('[scheduler] Fatal error:', err);
    process.exitCode = 1;
  });
}
