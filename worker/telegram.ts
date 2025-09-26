import type { Env } from './lib/env';
import { loadState, saveState, sendTelegram } from './lib/state';
import { getSchedulerSnapshot, stopSchedulers, wakeSchedulers, tickScheduler } from './scheduler';
import { getOpenProjects, progressEvents, type OpenProjectSummary, type MilestoneKey } from './progress';

interface TelegramChat {
  id?: number | string;
}

interface TelegramFrom {
  id?: number | string;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
}

interface TelegramMessage {
  text?: string;
  caption?: string;
  chat?: TelegramChat;
  from?: TelegramFrom;
}

export interface TelegramUpdate {
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_message?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  [key: string]: unknown;
}

interface TelegramMeta {
  webhookUrl?: string;
  lastCheckAt?: string;
}

const TELEGRAM_META_KEY = 'telegramMeta';
const WEBHOOK_REFRESH_MS = 30 * 60 * 1000;

const MILESTONE_MESSAGES: Record<MilestoneKey, string> = {
  website: '🎉 Website build finished!',
  stripe: '📊 Stripe products verified + synced.',
  tally: '🧩 Tally funnel audit complete.',
  social: '📱 New social batch scheduled.',
};

const deliveredMilestones = new Set<MilestoneKey>();

function extractMessage(update: TelegramUpdate): TelegramMessage | undefined {
  return update.message || update.channel_post || update.edited_message || update.edited_channel_post;
}

function commandFromText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return '';
  const first = trimmed.split(/\s+/)[0] || '';
  return first.split('@')[0] || '';
}

function readMessageText(message: TelegramMessage | undefined): string {
  if (!message) return '';
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (text) return text;
  const caption = typeof message.caption === 'string' ? message.caption.trim() : '';
  return caption;
}

function stripCommandPrefix(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return trimmed;
  const segments = trimmed.split(/\s+/);
  segments.shift();
  return segments.join(' ').trim();
}

function resolveWebhookUrl(env: Env, origin?: string): string | undefined {
  if ((env as any).TELEGRAM_WEBHOOK_URL) {
    return String((env as any).TELEGRAM_WEBHOOK_URL);
  }
  if (!origin) return undefined;
  return `${origin.replace(/\/$/, '')}/telegram`;
}

async function updateTelegramMeta(env: Env, meta: TelegramMeta): Promise<void> {
  const state = await loadState(env);
  const stored = typeof (state as any)[TELEGRAM_META_KEY] === 'object' ? (state as any)[TELEGRAM_META_KEY] : {};
  (state as any)[TELEGRAM_META_KEY] = { ...stored, ...meta };
  await saveState(env, state);
}

async function readTelegramMeta(env: Env): Promise<TelegramMeta> {
  const state = await loadState(env);
  const meta = (state as any)[TELEGRAM_META_KEY];
  if (meta && typeof meta === 'object') {
    return meta as TelegramMeta;
  }
  return {};
}

export async function ensureTelegramWebhook(env: Env, origin?: string): Promise<void> {
  const token = (env as any).TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const webhookUrl = resolveWebhookUrl(env, origin);
  if (!webhookUrl) return;

  const meta = await readTelegramMeta(env);
  const lastCheck = meta.lastCheckAt ? new Date(meta.lastCheckAt).getTime() : 0;
  const now = Date.now();
  if (meta.webhookUrl === webhookUrl && now - lastCheck < WEBHOOK_REFRESH_MS) {
    return;
  }

  try {
    const body = new URLSearchParams({ url: webhookUrl });
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      body,
    });
    if (!res.ok) {
      throw new Error(`Failed to set webhook: ${res.status}`);
    }
    const payload = await res.json().catch(() => ({}));
    if (!payload?.ok) {
      throw new Error(`Telegram rejected webhook: ${JSON.stringify(payload)}`);
    }
    await updateTelegramMeta(env, {
      webhookUrl,
      lastCheckAt: new Date(now).toISOString(),
    });
  } catch (err) {
    console.warn('[telegram] webhook registration failed', err);
    await updateTelegramMeta(env, {
      lastCheckAt: new Date(now).toISOString(),
    });
  }
}

async function repingAutomation(env: Env): Promise<void> {
  const state = await loadState(env);
  const actions = [
    'TikTok scheduler pinged',
    'Website builder pinged',
    'Retry loop reset',
  ];
  const autonomy = typeof state.autonomy === 'object' && state.autonomy ? state.autonomy : {};
  autonomy.lastActions = actions;
  autonomy.lastRunAt = new Date().toISOString();
  state.autonomy = autonomy;
  await saveState(env, state);
}

function isTaskActive(task: string): boolean {
  return !task.toLowerCase().startsWith('idle');
}

function determineSystemMode(snapshot: Awaited<ReturnType<typeof getSchedulerSnapshot>>): 'paused' | 'idle' | 'running' {
  if (snapshot.paused) return 'paused';
  const active = snapshot.currentTasks.filter(isTaskActive);
  return active.length ? 'running' : 'idle';
}

function summarizeTrends(trends: any[]): string {
  if (!Array.isArray(trends) || !trends.length) return 'n/a';
  return trends
    .slice(0, 3)
    .map((trend) => (typeof trend === 'string' ? trend : trend?.title || trend?.url || 'trend'))
    .join(', ');
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return `${clamped}%`;
}

function describeProjectProgress(project: OpenProjectSummary): string {
  const stepsLabel = project.totalSteps
    ? `${project.stepsCompleted}/${project.totalSteps} steps`
    : `${project.stepsCompleted} steps done`;
  return `${stepsLabel} • ${formatPercent(project.percentComplete)}`;
}

function formatProjectsSummary(projects: OpenProjectSummary[]): string {
  const lines: string[] = ['📋 Active Projects:'];
  for (const project of projects) {
    const current = project.currentStep?.trim() || 'In discovery';
    const started = formatTimestamp(project.startedAt);
    lines.push(`• ${project.name}`);
    lines.push(`  • Progress: ${describeProjectProgress(project)}`);
    lines.push(`  • Current: ${current}`);
    lines.push(`  • Started: ${started}`);
  }
  return lines.join('\n');
}

function nextPostFromState(state: any): string | undefined {
  const posts = Array.isArray(state?.scheduledPosts) ? state.scheduledPosts : undefined;
  if (!posts || !posts.length) return undefined;
  const first = typeof posts[0] === 'string' ? posts[0] : undefined;
  return first;
}

function readLastRecap(state: any): string | undefined {
  const summary = state?.summaryMeta;
  if (summary && typeof summary === 'object' && typeof summary.lastSentAt === 'string') {
    return summary.lastSentAt;
  }
  return undefined;
}

async function handleStatus(env: Env): Promise<void> {
  const snapshot = await tickScheduler(env);
  const state = await loadState(env);
  const projects = await getOpenProjects(env);
  const mode = determineSystemMode(snapshot);
  const website = typeof state.website === 'string' && state.website ? state.website : 'https://messyandmagnetic.com';
  const lastRecap = formatTimestamp(readLastRecap(state));
  const nextPost = nextPostFromState(state);
  const trends = summarizeTrends(snapshot.topTrends);
  const lines: string[] = [
    '📊 System Pulse',
    `• Mode: ${mode}`,
    `• Projects: ${projects.length}`,
    `• Last recap: ${lastRecap}`,
    `• Website: ${website}`,
    `• Queue: ${snapshot.scheduledPosts} scheduled, ${snapshot.retryQueue} retries`,
    `• Trends: ${trends}`,
  ];
  if (nextPost) {
    lines.push(`• Next post: ${formatTimestamp(nextPost)}`);
  }
  lines.push('');
  if (projects.length) {
    lines.push(formatProjectsSummary(projects));
  } else {
    lines.push('📋 No active projects right now.');
  }
  await sendTelegram(env, lines.join('\n'));
}

async function handleWake(env: Env): Promise<void> {
  const snapshot = await wakeSchedulers(env);
  await repingAutomation(env);
  await sendTelegram(env, '✅ Maggie restarted');
  await sendTelegram(env, `Tasks now: ${snapshot.currentTasks.slice(0, 3).join(', ')}`);
}

async function handleStop(env: Env): Promise<void> {
  await stopSchedulers(env);
  await sendTelegram(env, '🛑 Maggie paused');
}

async function handleHelp(env: Env): Promise<void> {
  await sendTelegram(
    env,
    [
      'ℹ️ Maggie controls:',
      '/status – system pulse + open projects',
      '/wake – restart automation loop',
      '/stop – pause schedulers (Telegram stays live)',
      '/projects – show active project pipelines',
      '/help – show this help',
    ].join('\n')
  );
}

function formatTimestamp(value?: string): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

async function handleProjects(env: Env): Promise<void> {
  const projects = await getOpenProjects(env);
  if (!projects.length) {
    await sendTelegram(env, '📋 No active projects right now.');
    return;
  }
  await sendTelegram(env, formatProjectsSummary(projects));
}

type ParsedIntent =
  | { kind: 'status' }
  | { kind: 'projects' }
  | { kind: 'task'; label: string }
  | { kind: 'unknown' };

function detectIntent(text: string): ParsedIntent {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'unknown' };
  const lowered = trimmed.toLowerCase();
  const statusHints = ['status', 'state', 'how are things', "what's happening", 'give me an update', 'how is it going'];
  if (statusHints.some((hint) => lowered.includes(hint))) {
    return { kind: 'status' };
  }
  const projectHints = ['project', 'pipeline', 'what are we working', 'progress on', 'in flight'];
  if (projectHints.some((hint) => lowered.includes(hint))) {
    return { kind: 'projects' };
  }
  const startMatch = trimmed.match(/(?:let['’]?s\s+)?(?:please\s+)?(?:go\s+)?(?:and\s+)?(?:kick off|start|spin up|begin|launch)\s+(.+)/i);
  if (startMatch) {
    const label = startMatch[1].trim();
    if (label) {
      return { kind: 'task', label };
    }
  }
  const confirmMatch = trimmed.match(/(?:i['’]?m|i am|we['’]?re|we are)\s+(?:starting|kick(?:ing)? off|launching)\s+(.+)/i);
  if (confirmMatch) {
    const label = confirmMatch[1].trim();
    if (label) {
      return { kind: 'task', label };
    }
  }
  return { kind: 'unknown' };
}

async function registerTaskStart(env: Env, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) return;
  const state = await loadState(env);
  const brain = (state as any).brain && typeof (state as any).brain === 'object' ? ((state as any).brain as Record<string, any>) : {};
  const existing = Array.isArray((brain as any).tasks) ? ((brain as any).tasks as any[]) : [];
  const tasks = [
    { label: trimmed, startedAt: new Date().toISOString() },
    ...existing.slice(0, 49),
  ];
  brain.tasks = tasks;
  (state as any).brain = brain;
  await saveState(env, state);
  await sendTelegram(env, `✅ started ${trimmed}`);
}

async function handleFreeformMessage(env: Env, message: TelegramMessage): Promise<void> {
  const text = readMessageText(message);
  if (!text) return;

  const command = commandFromText(text);
  const content = command ? stripCommandPrefix(text) : text;
  if (!content) {
    if (command) {
      await sendTelegram(env, "Share what you'd like me to note or ask for /help.");
    }
    return;
  }

  const intent = detectIntent(content);
  if (intent.kind === 'status') {
    await handleStatus(env);
    return;
  }
  if (intent.kind === 'projects') {
    await handleProjects(env);
    return;
  }
  if (intent.kind === 'task') {
    await registerTaskStart(env, intent.label);
    return;
  }
  const clipped = content.trim().replace(/\s+/g, ' ').slice(0, 120);
  const prefix = clipped ? `Noted “${clipped}.”` : 'Noted.';
  await sendTelegram(env, `${prefix} Say “status” for the system pulse or “projects” for the active builds.`);
}

interface MilestoneRecord {
  [key: string]: { sentAt: string; project: string };
}

async function handleMilestoneNotification({
  env,
  milestone,
  project,
}: {
  env: Env;
  milestone: MilestoneKey;
  project: OpenProjectSummary;
}): Promise<void> {
  const message = MILESTONE_MESSAGES[milestone];
  if (!message) return;
  if (deliveredMilestones.has(milestone)) return;
  deliveredMilestones.add(milestone);
  try {
    const state = await loadState(env);
    const bucket =
      state && typeof state === 'object' && typeof (state as any).milestoneAlerts === 'object'
        ? { ...(state as any).milestoneAlerts }
        : {};
    if (bucket[milestone]) {
      return;
    }
    bucket[milestone] = { sentAt: new Date().toISOString(), project: project.name };
    (state as any).milestoneAlerts = bucket as MilestoneRecord;
    await saveState(env, state);
    await sendTelegram(env, message);
  } catch (err) {
    deliveredMilestones.delete(milestone);
    throw err;
  }
}

progressEvents.on('milestone-complete', (payload) => {
  void handleMilestoneNotification(payload);
});

export async function handleTelegramUpdate(update: TelegramUpdate, env: Env, origin?: string): Promise<void> {
  await ensureTelegramWebhook(env, origin);
  const message = extractMessage(update);
  if (message?.from?.is_bot) return;

  const text = readMessageText(message);
  const command = text ? commandFromText(text) : '';
  if (command) {
    if (command === '/status') {
      await handleStatus(env);
    } else if (command === '/wake') {
      await handleWake(env);
    } else if (command === '/stop') {
      await handleStop(env);
    } else if (command === '/help') {
      await handleHelp(env);
    } else if (command === '/projects') {
      await handleProjects(env);
    } else if (command === '/summary') {
      await handleStatus(env);
    } else if (command === '/message') {
      if (!message) return;
      await handleFreeformMessage(env, message);
    } else {
      await handleHelp(env);
    }
    return;
  }

  if (!message) return;
  await handleFreeformMessage(env, message);
}
