import { watchRawFolder } from './maggie/tasks/watch-raw.ts';
import { runFullScheduler, type SchedulerStatus } from './maggie/tasks/scheduler.ts';
import { checkForFlops, startFlopMonitor } from './maggie/tasks/retry-flops.ts';
import { agentAct } from './bots/agents/agentbrain.ts';
import { loadConfigFromKV, type ThreadStateLoadResult } from './utils/loadConfigFromKV.ts';
import { postqThreadStateKey } from './config/env.ts';

export interface RunMaggieConfig {
  force?: boolean;
  browser?: boolean;
  browserType?: string;
  log?: boolean;
  source?: string;
}

export interface AutomationModuleStatus {
  name: string;
  enabled: boolean;
  detail?: string;
}

export interface LoopStatus {
  name: string;
  status: 'active' | 'error';
  detail?: string;
  error?: string;
}

export interface MaggieReadinessReport {
  timestamp: string;
  threadState: Pick<ThreadStateLoadResult, 'source' | 'key' | 'accountId' | 'namespaceId' | 'bytes' | 'error' | 'fallbackPath'>;
  automationModules: AutomationModuleStatus[];
  loops: LoopStatus[];
  warnings: string[];
}

function buildAutomationStatus(config: Record<string, any>): AutomationModuleStatus[] {
  const automation = config?.automation;
  if (!automation || typeof automation !== 'object') {
    return [];
  }

  return Object.entries(automation).map(([name, value]) => ({
    name,
    enabled: Boolean(value),
    detail: Boolean(value) ? 'Enabled via thread-state' : 'Disabled in thread-state',
  }));
}

function logThreadStateSummary(result: ThreadStateLoadResult, verbose: boolean): void {
  const { source, key, bytes, error, fallbackPath } = result;
  const summary: Record<string, unknown> = {
    source,
    key,
    bytes: bytes ?? null,
  };
  if (fallbackPath) summary.fallbackPath = fallbackPath;
  if (error) summary.error = error;

  if (verbose) {
    console.log('[runMaggie] Thread-state load summary:', summary);
  } else {
    console.log(
      `[runMaggie] Thread-state source=${source} key=${key}${
        typeof bytes === 'number' ? ` bytes=${bytes}` : ''
      }${fallbackPath ? ` fallback=${fallbackPath}` : ''}${error ? ' (with warnings)' : ''}`
    );
    if (error) {
      console.warn('[runMaggie] Thread-state warnings:', error);
    }
  }
}

async function wireDefaultIntents(): Promise<string | null> {
  try {
    const { intentParser } = await import('./maggie/intent-router.ts');
    if (!intentParser?.add) {
      return '⚠️ Intent parser unavailable; default commands were not registered.';
    }

    await intentParser.add([
      {
        pattern: /^caption (.+)/i,
        intent: 'setCaption',
        extract: (text) => ({
          caption: text.match(/^caption (.+)/i)?.[1] || '',
        }),
      },
      {
        pattern: /^schedule (.+)/i,
        intent: 'schedulePost',
        extract: (text) => ({
          time: text.match(/^schedule (.+)/i)?.[1] || '',
        }),
      },
      {
        pattern: /^upload (.+\.mp4)$/i,
        intent: 'uploadVideo',
        extract: (text) => ({
          videoPath: text.match(/^upload (.+\.mp4)$/i)?.[1] || '',
        }),
      },
      {
        pattern: /^comment (.+)/i,
        intent: 'addComment',
        extract: (text) => ({
          comment: text.match(/^comment (.+)/i)?.[1] || '',
        }),
      },
    ]);

    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `⚠️ Failed to wire default intents: ${message}`;
  }
}

async function startSchedulerLoop(forceImmediate: boolean): Promise<SchedulerStatus> {
  return runFullScheduler({ immediate: forceImmediate });
}

export async function runMaggie(config: RunMaggieConfig = {}): Promise<MaggieReadinessReport> {
  const warnings: string[] = [];

  // ✅ Load agent config from KV
  const threadState = await loadConfigFromKV(postqThreadStateKey);
  const fullConfig = threadState.config ?? {};

  logThreadStateSummary(threadState, Boolean(config.log));

  const maggieConfig = fullConfig?.agents?.maggie;
  if (!maggieConfig) {
    const warning = '⚠️ Maggie not found in agents config.';
    console.warn(warning);
    warnings.push(warning);
  } else {
    console.log('✅ Maggie config loaded from thread-state.');
    if (config.log) console.dir(maggieConfig, { depth: null });
  }

  // 🔁 Run agent actions (caption, comment, reply)
  try {
    await Promise.all([
      agentAct({
        botName: 'maggie',
        context: 'caption',
        inputText: 'Today’s soul energy update — what’s aligned?',
      }),
      agentAct({
        botName: 'willow',
        context: 'comment',
        inputText: 'Start soft engagement on recent post.',
      }),
      agentAct({
        botName: 'mars',
        context: 'reply',
        inputText: 'Troll alert. Handle like Mars.',
      }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const warning = `⚠️ Agent actions encountered an error: ${message}`;
    console.warn('[runMaggie] Agent act warning:', message);
    warnings.push(warning);
  }

  // 🧠 Auto-wire Maggie’s default text commands
  const intentWarning = await wireDefaultIntents();
  if (intentWarning) warnings.push(intentWarning);

  // 🔄 Start background task loops
  const loopStatuses: LoopStatus[] = [];

  try {
    watchRawFolder();
    loopStatuses.push({
      name: 'Raw footage watcher',
      status: 'active',
      detail: 'Watching ./drop for new uploads',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    loopStatuses.push({ name: 'Raw footage watcher', status: 'error', error: message });
    warnings.push(`❌ Failed to start raw watcher: ${message}`);
  }

  try {
    const status = await startSchedulerLoop(Boolean(config.force));
    loopStatuses.push({
      name: 'Scheduler loop',
      status: 'active',
      detail: status.nextRunAt
        ? `${config.force ? 'Immediate cycle triggered' : 'Background loop running'}; next run at ${status.nextRunAt}`
        : `${config.force ? 'Immediate cycle triggered' : 'Background loop running'}; awaiting next run`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    loopStatuses.push({ name: 'Scheduler loop', status: 'error', error: message });
    warnings.push(`❌ Scheduler loop failed to initialize: ${message}`);
  }

  try {
    const monitor = startFlopMonitor();
    loopStatuses.push({
      name: 'Flop monitor',
      status: 'active',
      detail: `Interval ${(monitor.intervalMs / 60000).toFixed(1)} minute(s)`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    loopStatuses.push({ name: 'Flop monitor', status: 'error', error: message });
    warnings.push(`❌ Flop monitor failed to start: ${message}`);
  }

  // Optional: run a manual flop check if requested
  if (config.force) {
    await checkForFlops().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`⚠️ Manual flop check failed: ${message}`);
      console.warn('[runMaggie] Manual flop check warning:', message);
    });
  }

  const readiness: MaggieReadinessReport = {
    timestamp: new Date().toISOString(),
    threadState: {
      source: threadState.source,
      key: threadState.key,
      accountId: threadState.accountId,
      namespaceId: threadState.namespaceId,
      bytes: threadState.bytes,
      error: threadState.error,
      fallbackPath: threadState.fallbackPath,
    },
    automationModules: buildAutomationStatus(fullConfig),
    loops: loopStatuses,
    warnings,
  };

  console.log('[runMaggie] Readiness report:', JSON.stringify(readiness, null, 2));

  return readiness;
}
