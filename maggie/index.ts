import { watchRawFolder } from './tasks/watch-raw';
import { scheduleNextPost } from './tasks/scheduler';
import { checkForFlops } from './tasks/retry-flops';

export interface RunMaggieConfig {
  force?: boolean;
  browser?: boolean;
  browserType?: string;
  log?: boolean;
  source?: string;
}

export async function runMaggie(config: RunMaggieConfig = {}): Promise<void> {
  watchRawFolder();
  scheduleNextPost();
  checkForFlops();
  if (config.log) {
    console.log('[runMaggie]', config);
  }
}
