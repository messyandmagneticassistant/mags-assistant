// maggie/watcher.ts

import { chromium } from 'playwright';
import readline from 'readline';
import { sendTelegramMessage } from '../utils/telegram';

export type HeadfulBrowserOptions = {
  mode: string;
  stream?: boolean;
  logScreenshots?: boolean;
  attachDebugger?: boolean;
};

export async function enableHeadfulBrowser(options: HeadfulBrowserOptions): Promise<void> {
  console.log('[enableHeadfulBrowser] Launching headful browser...', options);

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('https://www.tiktok.com');

  if (options.logScreenshots) {
    await page.screenshot({ path: 'debug.jpg' });
    console.log('[enableHeadfulBrowser] Screenshot saved as debug.jpg');
  }

  await browser.close();
}

export type StatusBlock = {
  type: string;
  label: string;
  value?: string;
  dynamic?: boolean;
  action?: string;
};

export type CreateStatusCardOptions = {
  title: string;
  blocks: StatusBlock[];
  destination?: string;
  editable?: boolean;
  notify?: boolean;
};

export async function createStatusCard(options: CreateStatusCardOptions): Promise<void> {
  const msg = `📋 ${options.title}\n` + options.blocks.map(b => `• ${b.label}: ${b.value || '—'}`).join('\n');
  await sendTelegramMessage(msg);
  console.log('[createStatusCard] Sent to Telegram ✅');
}

export type StartAgentConsoleOptions = {
  allowManualInput?: boolean;
  allowCancel?: boolean;
  allowQueueInsert?: boolean;
  visibleTo?: string[];
  liveFeed?: boolean;
};

export async function startAgentConsole(options: StartAgentConsoleOptions): Promise<void> {
  if (!options.allowManualInput) return;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('🧠 Maggie CLI Console — Type a command:');

  rl.on('line', async (input) => {
    const command = input.trim();
    if (command.toLowerCase() === 'exit') {
      rl.close();
    } else {
      await sendTelegramMessage(`🧠 Manual Command: ${command}`);
      console.log(`➡️ Sent command: ${command}`);
    }
  });
}

export type PostLogUpdateOptions = {
  type: string;
  message: string;
  context?: string[];
};

export async function postLogUpdate(options: PostLogUpdateOptions): Promise<void> {
  const msg = `🔔 ${options.type.toUpperCase()}:\n${options.message}`;
  await sendTelegramMessage(msg);
  console.log('[postLogUpdate] Sent to Telegram ✅');
}