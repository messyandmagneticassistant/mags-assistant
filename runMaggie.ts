// runMaggie.ts

import { watchRawFolder } from './bots/maggie/tasks/watch-raw.ts';
import { scheduleNextPost } from './bots/maggie/tasks/scheduler.ts';
import { checkForFlops } from './bots/maggie/tasks/retry-flops.ts';
import { intentParser } from './intent-router.ts';

import { threadStateKey } from './config/env.ts';
import { loadConfigFromKV } from './utils/loadSecretsFromBlob.ts';
import { agentAct } from './bots/agents/agentbrain.ts';

export interface RunMaggieConfig {
  force?: boolean;
  browser?: boolean;
  browserType?: string;
  log?: boolean;
  source?: string;
}

export async function runMaggie(config: RunMaggieConfig = {}): Promise<void> {
  // ✅ Load agent config from KV
  const fullConfig = await loadConfigFromKV(threadStateKey);

  if (!fullConfig?.agents?.maggie) {
    console.warn('⚠️ Maggie not found in agents config.');
  } else {
    console.log('✅ Maggie config loaded from thread-state.');
    if (config.log) console.dir(fullConfig.agents.maggie, { depth: null });
  }

  // 🔁 Run agent actions (caption, comment, reply)
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

  // 🧠 Auto-wire Maggie’s default text commands
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

  // 🔄 Start background task loops
  watchRawFolder();
  scheduleNextPost();
  checkForFlops();

  if (config.log) {
    console.log('[runMaggie] Task loops started.');
  }
}