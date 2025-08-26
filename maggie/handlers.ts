// maggie/handler.ts

import { addCommandRouter, intentParser } from './intent-router';
import { runMaggie } from './index';
import { checkForFlops } from './tasks/retry-flops';
import { scheduleNextPost } from './tasks/scheduler';
import { postLogsTo } from './intent-router';

await addCommandRouter({
  async onIntent(intent, data, ctx) {
    switch (intent) {
      case 'runMaggie':
        await runMaggie({ force: true, ...data });
        break;
      case 'retryFlops':
        await checkForFlops();
        break;
      case 'nextPost':
        await scheduleNextPost();
        break;
      case 'log':
        await postLogsTo(data.targets || []);
        break;
      case 'pause':
        console.log('[maggie] Pause requested.'); // You can implement a shared pause flag if needed
        break;
      case 'resume':
        console.log('[maggie] Resume requested.');
        break;
      default:
        console.warn(`[handler] Unknown intent: ${intent}`);
    }
  },
});

// Register trigger phrases
await intentParser.add([
  {
    pattern: /^post\s+now$/i,
    intent: 'runMaggie',
    extract: () => ({}),
  },
  {
    pattern: /^retry\s+flops$/i,
    intent: 'retryFlops',
    extract: () => ({}),
  },
  {
    pattern: /^next\s+post$/i,
    intent: 'nextPost',
    extract: () => ({}),
  },
  {
    pattern: /^pause$/i,
    intent: 'pause',
    extract: () => ({}),
  },
  {
    pattern: /^resume$/i,
    intent: 'resume',
    extract: () => ({}),
  },
  {
    pattern: /^log\s+to\s+(.+)$/i,
    intent: 'log',
    extract: (text) => {
      const match = text.match(/^log\s+to\s+(.+)$/i);
      return { targets: match?.[1]?.split(',').map(t => t.trim()) || [] };
    },
  },
]);