#!/usr/bin/env ts-node
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { resolveConflictsInRepo } from './self-healing/telegramConflictResolver';
import { logRepairEvent, type RepairTrigger } from './self-healing/logging';
import fs from 'node:fs/promises';
import path from 'node:path';
import cron from 'node-cron';

interface RepairOptions {
  trigger: RepairTrigger;
  dryRun?: boolean;
  verbose?: boolean;
}

interface RepairOutcome {
  mergedFiles: string[];
  hadConflicts: boolean;
  ranTests: boolean;
  testsPassed: boolean;
  deployed: boolean;
  restartRan: boolean;
  telegramNotified: boolean;
}

function parseArgs(): { watch: boolean; trigger: RepairTrigger; dryRun: boolean; verbose: boolean } {
  const args = new Set(process.argv.slice(2));
  const watch = args.has('--watch');
  const dryRun = args.has('--dry-run');
  const verbose = args.has('--verbose');

  const triggerArg = [...args]
    .find((arg) => arg.startsWith('--trigger='))
    ?.split('=')[1] as RepairTrigger | undefined;
  const trigger: RepairTrigger = triggerArg && ['cron', 'telegram', 'manual'].includes(triggerArg)
    ? triggerArg
    : watch
      ? 'cron'
      : 'manual';

  return { watch, trigger, dryRun, verbose };
}

async function ensureFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function validateTelegramRoutes(): Promise<string[]> {
  const problems: string[] = [];
  const routeFile = path.resolve('worker/routes/telegram.ts');
  if (!(await ensureFileExists(routeFile))) {
    problems.push('worker/routes/telegram.ts missing');
    return problems;
  }

  const contents = await fs.readFile(routeFile, 'utf8');
  if (!contents.includes('handleTelegramUpdate')) {
    problems.push('handleTelegramUpdate import missing from worker route');
  }
  if (!/onRequest(Post|Get)/.test(contents)) {
    problems.push('worker telegram route missing Cloudflare entry point');
  }
  return problems;
}

function runCommand(command: string, options?: { cwd?: string; verbose?: boolean }): Promise<{ ok: boolean; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: 'inherit', cwd: options?.cwd });
    child.on('close', (code) => {
      if (options?.verbose) {
        console.log(`[self-healing] command ${command} exited with`, code);
      }
      resolve({ ok: code === 0, code });
    });
  });
}

async function runTests(verbose: boolean): Promise<boolean> {
  const command = process.env.TELEGRAM_REPAIR_TEST_COMMAND || 'pnpm test';
  if (verbose) {
    console.log(`[self-healing] running tests via: ${command}`);
  }
  const result = await runCommand(command, { verbose });
  return result.ok;
}

async function deployWorker(verbose: boolean): Promise<boolean> {
  const command = process.env.TELEGRAM_REPAIR_DEPLOY_COMMAND || 'pnpm run deploy:public';
  if (command === 'skip') {
    if (verbose) {
      console.log('[self-healing] skipping deploy per config');
    }
    return true;
  }
  if (verbose) {
    console.log(`[self-healing] deploying worker via: ${command}`);
  }
  const result = await runCommand(command, { verbose });
  return result.ok;
}

async function restartServices(verbose: boolean): Promise<boolean> {
  const command = process.env.TELEGRAM_REPAIR_RESTART_COMMAND;
  if (!command) {
    if (verbose) {
      console.log('[self-healing] no restart command configured');
    }
    return false;
  }
  if (verbose) {
    console.log(`[self-healing] restarting services via: ${command}`);
  }
  const result = await runCommand(command, { verbose });
  return result.ok;
}

async function sendTelegram(text: string, verbose: boolean): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_DEFAULT_CHAT_ID;
  if (!token || !chatId) {
    if (verbose) {
      console.warn('[self-healing] missing Telegram credentials, cannot send notification');
    }
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    if (!res.ok && verbose) {
      console.warn('[self-healing] Telegram send failed', await res.text());
    }
    return res.ok;
  } catch (err) {
    if (verbose) {
      console.warn('[self-healing] Telegram send error', err);
    }
    return false;
  }
}

async function commitResolvedFiles(files: string[], verbose: boolean): Promise<boolean> {
  if (!files.length) return false;
  const add = spawnSync('git', ['add', ...files]);
  if (add.status !== 0) {
    console.warn('[self-healing] git add failed', add.stderr?.toString());
    return false;
  }
  const status = spawnSync('git', ['status', '--porcelain']);
  const hasChanges = Boolean(status.stdout?.toString().trim());
  if (!hasChanges) {
    if (verbose) {
      console.log('[self-healing] nothing to commit');
    }
    return false;
  }

  const commit = spawnSync('git', ['commit', '-m', 'auto: resolved Telegram handler conflict']);
  if (commit.status !== 0) {
    console.warn('[self-healing] git commit failed', commit.stderr?.toString());
    return false;
  }
  if (verbose) {
    console.log('[self-healing] committed auto-merge results');
  }
  return true;
}

async function runSelfHealing(options: RepairOptions): Promise<RepairOutcome> {
  const results = await resolveConflictsInRepo();
  const conflicts = results.filter((r) => r.hadConflicts);
  const resolvedFiles = conflicts.filter((r) => r.resolved).map((r) => r.filePath);
  const hadConflicts = conflicts.length > 0;
  const resolvedAny = resolvedFiles.length > 0;

  if (options.verbose) {
    console.log('[self-healing] conflict scan summary:', {
      scanned: results.length,
      conflicts: conflicts.length,
      resolved: resolvedFiles.length,
    });
  }

  if (!resolvedAny && !hadConflicts) {
    await logRepairEvent({
      action: 'check',
      trigger: options.trigger,
      success: true,
      message: 'No telegram.ts conflicts detected',
    });
    return {
      mergedFiles: [],
      hadConflicts: false,
      ranTests: false,
      testsPassed: false,
      deployed: false,
      restartRan: false,
      telegramNotified: false,
    };
  }

  let testsPassed = false;
  let deployed = false;
  let restartRan = false;
  let telegramNotified = false;

  if (hadConflicts && !resolvedAny && !options.dryRun) {
    await sendTelegram('🧯 Maggie is offline. Auto-repair sequence initiated...', options.verbose ?? false);
    await logRepairEvent({
      action: 'merge',
      trigger: options.trigger,
      success: false,
      message: 'Conflicts detected but automatic resolver produced no changes',
    });
  }

  if (resolvedAny && !options.dryRun) {
    await commitResolvedFiles(resolvedFiles, options.verbose ?? false);
  }

  const problems = await validateTelegramRoutes();
  if (problems.length) {
    await logRepairEvent({
      action: 'check',
      trigger: options.trigger,
      success: false,
      message: `Route validation issues: ${problems.join(', ')}`,
    });
  }

  if (!options.dryRun) {
    testsPassed = await runTests(options.verbose ?? false);
    await logRepairEvent({
      action: 'merge',
      trigger: options.trigger,
      success: testsPassed,
      message: testsPassed ? 'Conflicts resolved and tests passed' : 'Conflicts resolved but tests failed',
    });

    if (testsPassed) {
      deployed = await deployWorker(options.verbose ?? false);
      await logRepairEvent({
        action: 'deploy',
        trigger: options.trigger,
        success: deployed,
        message: deployed ? 'Worker deployment command executed' : 'Worker deploy command failed',
      });

      restartRan = await restartServices(options.verbose ?? false);
      await logRepairEvent({
        action: 'restart',
        trigger: options.trigger,
        success: restartRan,
        message: restartRan ? 'Restart command executed' : 'Restart command missing or failed',
      });

      if (deployed) {
        telegramNotified = await sendTelegram('Maggie is fully back online 🚀', options.verbose ?? false);
      }
    }
  }

  if (options.verbose) {
    console.log('[self-healing] outcome', { resolvedFiles, testsPassed, deployed, restartRan, telegramNotified });
  }

  return {
    mergedFiles: resolvedFiles,
    hadConflicts,
    ranTests: !options.dryRun,
    testsPassed,
    deployed,
    restartRan,
    telegramNotified,
  };
}

async function runAndReport(options: RepairOptions): Promise<void> {
  const outcome = await runSelfHealing(options);
  if (options.verbose) {
    console.log('[self-healing] finished run', outcome);
  }
}

async function bootstrapWatcher(trigger: RepairTrigger, dryRun: boolean, verbose: boolean) {
  console.log('[self-healing] watcher active, running every 10 minutes');
  cron.schedule('*/10 * * * *', async () => {
    console.log('[self-healing] cron tick');
    try {
      await runAndReport({ trigger, dryRun, verbose });
    } catch (err) {
      console.error('[self-healing] cron execution failed', err);
      await logRepairEvent({ action: 'check', trigger, success: false, message: `Cron execution error: ${err}` });
    }
  });
}

(async () => {
  const { watch, trigger, dryRun, verbose } = parseArgs();

  if (watch) {
    await bootstrapWatcher(trigger, dryRun, verbose);
    // Keep process alive
    while (true) {
      await wait(60_000);
    }
  } else {
    await runAndReport({ trigger, dryRun, verbose });
  }
})();
