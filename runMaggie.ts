// runMaggie.ts

import { watchRawFolder } from './maggie/tasks/watch-raw';
import { scheduleNextPost } from './maggie/tasks/scheduler';
import { checkForFlops } from './maggie/tasks/retry-flops';
import { intentParser } from './intent-router';

import { threadStateKey } from '@/config/env';
import { loadConfigFromKV } from '@/utils/loadConfigFromKV';
import { agentAct } from './bots/agents/agentbrain';

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

  // 🔄 Start background task loops
  watchRawFolder();
  scheduleNextPost();
  checkForFlops();

  if (config.log) {
    console.log('[runMaggie] Task loops started.');
  }
}