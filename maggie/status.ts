import path from 'path';
import { promises as fs } from 'fs';

import type { Task } from '../lib/task.js';
import { readTasks } from '../lib/task.js';

interface BrainSyncLog {
  status?: string;
  attemptedAt?: string;
  key?: string;
  bytes?: number;
  source?: string;
  trigger?: string;
  error?: string;
  skipReason?: string;
}

function formatRelativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return 'just now';
  if (abs < hour) {
    const minutes = Math.round(diff / minute);
    const value = Math.abs(minutes);
    const unit = value === 1 ? 'minute' : 'minutes';
    return minutes >= 0 ? `${value} ${unit} ago` : `in ${value} ${unit}`;
  }
  if (abs < day) {
    const hours = Math.round(diff / hour);
    const value = Math.abs(hours);
    const unit = value === 1 ? 'hour' : 'hours';
    return hours >= 0 ? `${value} ${unit} ago` : `in ${value} ${unit}`;
  }
  const days = Math.round(diff / day);
  const value = Math.abs(days);
  const unit = value === 1 ? 'day' : 'days';
  return days >= 0 ? `${value} ${unit} ago` : `in ${value} ${unit}`;
}

function extractRecentTasks(tasks: Task[]) {
  return tasks
    .map((task) => {
      const lastRun = task?.metadata?.lastRun;
      return typeof lastRun === 'string' && lastRun.trim().length
        ? { name: task.name, lastRun }
        : null;
    })
    .filter((entry): entry is { name: string; lastRun: string } => !!entry)
    .sort((a, b) => Date.parse(b.lastRun) - Date.parse(a.lastRun))
    .slice(0, 3);
}

async function loadQueueSummary() {
  const queuePath = path.resolve('queue.json');
  try {
    const raw = await fs.readFile(queuePath, 'utf8');
    const parsed = JSON.parse(raw) as { items?: unknown[]; failures?: unknown[]; lastRunAt?: string };
    const queued = Array.isArray(parsed.items) ? parsed.items.length : 0;
    const failures = Array.isArray(parsed.failures) ? parsed.failures.length : 0;
    const lastRunAt = typeof parsed.lastRunAt === 'string' ? parsed.lastRunAt : null;
    return { queued, failures, lastRunAt };
  } catch {
    return null;
  }
}

async function loadBrainSyncLog(): Promise<BrainSyncLog | null> {
  const logPath = path.resolve('brain-status.log');
  try {
    const raw = await fs.readFile(logPath, 'utf8');
    const data = JSON.parse(raw) as BrainSyncLog;
    return data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[maggie-status] Unable to read brain-status.log:', err);
    }
    return null;
  }
}

export async function buildMaggieStatusMessage(): Promise<string> {
  const loops = [
    '📂 Raw footage watcher',
    '🗓️ Scheduler + poster loop',
    '♻️ Retry flops monitor',
  ];

  let tasks: Task[] = [];
  try {
    tasks = await readTasks();
  } catch (err) {
    console.warn('[maggie-status] Unable to read tasks.json:', err);
  }

  const totalTasks = tasks.length;
  const completed = tasks.filter((task) => typeof task?.metadata?.lastRun === 'string').length;
  const pending = Math.max(totalTasks - completed, 0);

  const recent = extractRecentTasks(tasks);
  const queue = await loadQueueSummary();
  const brainLog = await loadBrainSyncLog();

  const parts: string[] = [];
  parts.push(`<b>Active loops</b>\n${loops.map((loop) => `• ${loop}`).join('\n')}`);

  parts.push(
    `<b>Task queue</b>\n${
      totalTasks
        ? `${totalTasks} total • ${pending} pending • ${completed} completed`
        : 'No queued tasks on disk.'
    }`
  );

  if (recent.length) {
    const recentLines = recent
      .map((entry) => `• ${entry.name} — ${formatRelativeTime(entry.lastRun)}`)
      .join('\n');
    parts.push(`<b>Recent runs</b>\n${recentLines}`);
  } else {
    parts.push('<b>Recent runs</b>\nNo completed tasks recorded yet.');
  }

  if (queue) {
    const lines = [`${queue.queued} queued • ${queue.failures} failures`];
    if (queue.lastRunAt) {
      lines.push(`Last worker tick: ${formatRelativeTime(queue.lastRunAt)}`);
    }
    parts.push(`<b>Ops queue</b>\n${lines.join('\n')}`);
  }

  if (brainLog) {
    const status = (brainLog.status ?? 'unknown').toLowerCase();
    let statusLabel = 'ℹ️ Prepared';
    if (status === 'success') statusLabel = '✅ Success';
    else if (status === 'failed') statusLabel = '❌ Failed';
    const lines = [statusLabel];
    if (brainLog.attemptedAt) {
      lines.push(`Last sync: ${formatRelativeTime(brainLog.attemptedAt)}`);
    }
    if (brainLog.key) {
      const sizeInfo = typeof brainLog.bytes === 'number' && Number.isFinite(brainLog.bytes)
        ? `${brainLog.key} (${brainLog.bytes} bytes)`
        : brainLog.key;
      lines.push(`Key: ${sizeInfo}`);
    }
    if (brainLog.trigger || brainLog.source) {
      const triggerText = [brainLog.source, brainLog.trigger].filter(Boolean).join(' • ');
      if (triggerText) lines.push(triggerText);
    }
    if (brainLog.skipReason) {
      lines.push(brainLog.skipReason);
    }
    if (brainLog.error) {
      lines.push(`Error: ${brainLog.error}`);
    }
    parts.push(`<b>Brain sync</b>\n${lines.join('\n')}`);
  } else {
    parts.push('<b>Brain sync</b>\nNo brain sync log recorded yet.');
  }

  parts.push(`<i>Updated ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC</i>`);

  return parts.join('\n\n');
}
