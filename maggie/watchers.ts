// maggie/watcher.ts

import { tgSend } from '../lib/telegram'; // Optional: Replace with your actual notifier(s)
import { getConfig } from '../utils/config';

export type HeadfulBrowserOptions = {
  mode: string;
  stream?: boolean;
  logScreenshots?: boolean;
  attachDebugger?: boolean;
};

export async function enableHeadfulBrowser(options: HeadfulBrowserOptions): Promise<void> {
  console.log('[enableHeadfulBrowser] starting', options);
  // This is where you'd launch puppeteer/playwright headful instance
  // (Placeholder, implemented elsewhere in Maggie's browser runner)
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
  console.log('[createStatusCard] creating', options);
  // Future: Post to dashboard, Discord embed, Telegram, etc.
  if (options.notify) {
    await tgSend(`🧠 Status Card: <b>${options.title}</b>\n\n${options.blocks.map(b => `• <b>${b.label}</b>: ${b.value ?? ''}`).join('\n')}`);
  }
}

export type StartAgentConsoleOptions = {
  allowManualInput?: boolean;
  allowCancel?: boolean;
  allowQueueInsert?: boolean;
  visibleTo?: string[];
  liveFeed?: boolean;
};

export async function startAgentConsole(options: StartAgentConsoleOptions): Promise<void> {
  console.log('[startAgentConsole] launching', options);
  // Future: Open interactive session for Maggie ops
}

export type PostLogUpdateOptions = {
  type: string;
  message: string;
  context?: string[];
};

export async function postLogUpdate(options: PostLogUpdateOptions): Promise<void> {
  console.log('[postLogUpdate]', options);
  // Future: post to DB, feed, or chat
  const ctxText = options.context?.length ? ` (${options.context.join(', ')})` : '';
  await tgSend(`🔍 <b>${options.type.toUpperCase()}</b>${ctxText}\n${options.message}`);
}