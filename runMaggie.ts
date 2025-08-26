// runMaggie.ts

import { watchRawFolder } from './maggie/tasks/watch-raw';
import { scheduleNextPost } from './maggie/tasks/scheduler';
import { checkForFlops } from './maggie/tasks/retry-flops';
import { intentParser } from './intent-router';

export interface RunMaggieConfig {
  force?: boolean;
  browser?: boolean;
  browserType?: string;
  log?: boolean;
  source?: string;
}

export async function runMaggie(config: RunMaggieConfig = {}): Promise<void> {
  // 🧠 Auto-wire Maggie's default text commands
  await intentParser.add([
    {
      pattern: /^caption (.+)/i,
      intent: 'setCaption',
      extract: (text) => ({ caption: text.match(/^caption (.+)/i)?.[1] || '' }),
    },
    {
      pattern: /^schedule (.+)/i,
      intent: 'schedulePost',
      extract: (text) => ({ time: text.match(/^schedule (.+)/i)?.[1] || '' }),
    },
    {
      pattern: /^upload (.+\.mp4)$/i,
      intent: 'uploadVideo',
      extract: (text) => ({ videoPath: text.match(/^upload (.+\.mp4)$/i)?.[1] || '' }),
    },
    {
      pattern: /^comment (.+)/i,
      intent: 'addComment',
      extract: (text) => ({ comment: text.match(/^comment (.+)/i)?.[1] || '' }),
    },
  ]);

  // 🌀 Start her background task loops
  watchRawFolder();
  scheduleNextPost();
  checkForFlops();

  if (config.log) {
    console.log('[runMaggie]', config);
  }
}