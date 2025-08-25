import { enableHeadfulBrowser, startAgentConsole, createStatusCard, postLogUpdate } from './maggie/watchers';

// Enable full visible browser
await enableHeadfulBrowser({
  mode: 'puppeteer',
  stream: true, // for screen output
  logScreenshots: true,
  attachDebugger: true
});

// Create a real-time Notion status card
await createStatusCard({
  title: '🧠 Maggie Agent Status',
  blocks: [
    { type: 'status', label: 'Current Task', value: 'Listening for commands...' },
    { type: 'queue', label: 'Queue', dynamic: true },
    { type: 'log', label: 'Last Log', dynamic: true },
    { type: 'button', label: 'Force Reboot Maggie', action: 'reboot_agent' }
  ],
  destination: 'Notion',
  editable: true,
  notify: true
});

// Start Agent Console for live override
await startAgentConsole({
  allowManualInput: true,
  allowCancel: true,
  allowQueueInsert: true,
  visibleTo: ['Chanel', 'Eden'],
  liveFeed: true
});

// Post initial status
await postLogUpdate({
  type: 'agent_startup',
  message: 'Maggie has started watch mode and is ready to take commands from Telegram or Notion.',
  context: ['startup', 'watch-mode']
});

console.log('✅ Maggie Agent Console with Visual Watch Mode is running.');
