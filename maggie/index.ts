// maggie/index.ts
import { watchRawFolder } from './tasks/watch-raw';
import { scheduleNextPost } from './tasks/scheduler';
import { checkForFlops } from './tasks/retry-flops';
import { startMaggie } from '../src/maggie'; // 🔥 Your full logic loop

export interface RunMaggieConfig {
  force?: boolean;
  browser?: boolean;
  browserType?: string;
  log?: boolean;
  source?: string;
}

export async function runMaggie(config: RunMaggieConfig = {}): Promise<void> {
  if (config.log) {
    console.log('[runMaggie] Config:', config);
  }

  watchRawFolder();
  scheduleNextPost();
  checkForFlops();

  // 🧠 Fire Maggie’s core brain upload logic
  await startMaggie();
}