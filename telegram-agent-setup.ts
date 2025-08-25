// 🧠 Enable Telegram Command Routing + Maggie Browser Agent
import { runMaggie } from './maggie';
import { updateBrain } from './brain';
import { addCommandRouter, intentParser, postLogsTo } from './maggie/handlers';

// Step 1: Add Command Intent Parser to recognize natural commands
await intentParser.add([
  {
    pattern: /fix (.+)/i,
    intent: 'fix_thing',
    extract: (text: string) => ({ task: text.match(/fix (.+)/i)![1] }),
  },
  {
    pattern: /check (.+)/i,
    intent: 'check_status',
    extract: (text: string) => ({ thing: text.match(/check (.+)/i)![1] }),
  },
  {
    pattern: /(can you|please|maggie).*/i,
    intent: 'general_request',
    extract: (text: string) => ({ request: text }),
  }
]);

// Step 2: Add Command Router
await addCommandRouter({
  onIntent: async (intent, data, ctx) => {
    switch (intent) {
      case 'fix_thing':
        ctx.queue.add({ type: 'fix', payload: data.task });
        break;
      case 'check_status':
        ctx.queue.add({ type: 'check', payload: data.thing });
        break;
      case 'general_request':
        ctx.queue.add({ type: 'custom', payload: data.request });
        break;
    }
  },
});

// Step 3: Enable Browser Mode (Playwright or Puppeteer)
await runMaggie({
  force: true,
  browser: true,
  browserType: 'puppeteer', // fallback to 'browserless' if needed
  log: true,
  source: 'telegram-agent-setup',
});

// Step 4: Update central brain
await updateBrain({
  trigger: 'enable-agent-control',
  updates: {
    telegramCommandsEnabled: true,
    browserEnabled: true,
    intentParserReady: true,
    postLogsDaily: true,
    allowNaturalLanguageQueue: true,
    fallbackBrowserless: true,
  },
});

// Step 5: Post logs
await postLogsTo('telegram', 'notion');

// ✅ Done
console.log('✅ Maggie agent browser + Telegram control enabled.');
