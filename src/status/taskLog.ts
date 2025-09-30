import { promises as fs } from 'node:fs';
import path from 'node:path';

const TASK_LOG_PATH = path.resolve(process.cwd(), 'var', 'runtime', 'tasklog.json');
const MAX_ENTRIES = 200;

export interface TaskLogEntry {
  timestamp: string;
  task: string;
  detail?: string;
  outcome?: string;
}

async function ensureLogFile(): Promise<void> {
  const dir = path.dirname(TASK_LOG_PATH);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(TASK_LOG_PATH);
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      await fs.writeFile(TASK_LOG_PATH, '[]\n', 'utf8');
    } else {
      throw err;
    }
  }
}

async function readAll(): Promise<TaskLogEntry[]> {
  await ensureLogFile();
  try {
    const raw = await fs.readFile(TASK_LOG_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) {
      const entries: TaskLogEntry[] = [];
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        const ts = typeof entry.timestamp === 'string' ? entry.timestamp : '';
        const task = typeof entry.task === 'string' ? entry.task : '';
        if (!ts || !task) continue;
        entries.push({
          timestamp: ts,
          task,
          detail: typeof (entry as any).detail === 'string' ? (entry as any).detail : undefined,
          outcome: typeof (entry as any).outcome === 'string' ? (entry as any).outcome : undefined,
        });
      }
      return entries;
    }
  } catch (err) {
    console.warn('[taskLog] Failed to parse task log:', err);
  }
  return [];
}

export async function appendTaskLog(entry: Partial<TaskLogEntry> & { task: string }): Promise<void> {
  const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
  const normalized: TaskLogEntry = {
    timestamp: timestamp.toISOString(),
    task: entry.task,
    detail: entry.detail ? String(entry.detail) : undefined,
    outcome: entry.outcome ? String(entry.outcome) : undefined,
  };

  const entries = await readAll();
  entries.push(normalized);
  const trimmed = entries.slice(-MAX_ENTRIES);
  await fs.writeFile(TASK_LOG_PATH, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
}

export async function readRecentTasks(limit = 5): Promise<TaskLogEntry[]> {
  const entries = await readAll();
  if (!entries.length) return [];
  return entries.slice(-limit).reverse();
}

export function getTaskLogPath(): string {
  return TASK_LOG_PATH;
}
