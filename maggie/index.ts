// maggie/index.ts
import { watchRawFolder } from './tasks/watch-raw';
import { scheduleNextPost } from './tasks/scheduler';
import { checkForFlops } from './tasks/retry-flops';
import { startMaggie } from '../src/maggie'; // 🧠 Main logic loop
import { updateBrain } from '../brain'; // 🧠 Self-training brain logger
import { runBrowserUploadFlow } from '../src/utils/browser-actions/runBrowserUploadFlow'; // ⬆️ Optional: TikTok frontend upload

export interface RunMaggieConfig {
  force?: boolean;
  browser?: boolean;
  browserType?: string;
  log?: boolean;
  source?: string; // e.g., 'cron', 'telegram', 'manual'
}

export async function runMaggie(config: RunMaggieConfig = {}): Promise<void> {
  const { log = false, source = 'system', browser = false } = config;

  if (log) {
    console.log('[🟢 runMaggie START]', config);
  }

  try {
    // ⏯ File watcher
    watchRawFolder();

    // 📆 Scheduler
    await scheduleNextPost();

    // 🔁 Retry flops
    await checkForFlops();

    // 🧠 Fire Maggie’s full loop
    await startMaggie();

    // 🌐 Optionally trigger browser upload
    if (browser) {
      const browserResult = await runBrowserUploadFlow({ bot: { name: 'main' } });
      if (log) console.log('🌐 Browser task result:', browserResult);
    }

    // 🧠 Self-update her memory
    await updateBrain({
      newInput: '✅ Maggie cycle completed',
      source,
    });

    if (log) {
      console.log('[✅ runMaggie DONE]');
    }
  } catch (err) {
    console.error('[❌ runMaggie ERROR]', err);
    await updateBrain({
      newInput: `❌ Maggie encountered an error: ${err.message || err}`,
      source,
    });
  }
}