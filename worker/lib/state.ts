import type { Env } from './env';
import type { MaggieState, MaggieTrend } from '../../shared/maggieState';
import { THREAD_STATE_KEY } from '../../shared/maggieState';

function resolveStateKV(env: Env): KVNamespace | undefined {
  const kv = (env as any).PostQ ?? (env as any).POSTQ ?? env.BRAIN;
  if (kv && typeof kv.get === 'function' && typeof kv.put === 'function') {
    return kv as KVNamespace;
  }
  return undefined;
}

export async function loadState(env: Env): Promise<MaggieState> {
  const kv = resolveStateKV(env);
  if (!kv) return {};
  try {
    const raw = await kv.get(THREAD_STATE_KEY, 'json');
    if (raw && typeof raw === 'object') {
      return raw as MaggieState;
    }
  } catch (err) {
    console.warn('[state] Failed to load thread-state:', err);
  }
  return {};
}

export async function saveState(env: Env, state: MaggieState): Promise<void> {
  const kv = resolveStateKV(env);
  if (!kv) return;
  try {
    await kv.put(THREAD_STATE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[state] Failed to save thread-state:', err);
  }
}

export async function resetState(env: Env): Promise<void> {
  await saveState(env, {} as MaggieState);
}

type TrendEntry = MaggieTrend & { id?: string };

function coerceTrendId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function normalizeTrendEntry(entry: unknown): TrendEntry | null {
  if (!entry) return null;
  if (typeof entry === 'string') {
    return { title: entry } satisfies TrendEntry;
  }
  if (typeof entry === 'object') {
    const obj = entry as Record<string, unknown>;
    const titleCandidate = obj.title ?? obj.name ?? obj.caption;
    let title = typeof titleCandidate === 'string' ? titleCandidate.trim() : '';
    if (!title && typeof obj.url === 'string') {
      title = obj.url.trim();
    }
    if (!title) return null;

    const normalized: Record<string, unknown> = { ...obj, title };
    const id = coerceTrendId(obj.id);
    if (id) {
      normalized.id = id;
    } else {
      delete normalized.id;
    }
    return normalized as TrendEntry;
  }
  return null;
}

export function normalizeTrends(trends: unknown): TrendEntry[] | undefined {
  if (!Array.isArray(trends)) return undefined;
  const normalized: TrendEntry[] = [];
  for (const entry of trends) {
    const trend = normalizeTrendEntry(entry);
    if (trend) {
      normalized.push(trend);
    }
  }
  return normalized.length ? normalized : undefined;
}

export async function sendTelegram(env: Env, text: string) {
  const token = (env as any).TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;
  const chatId = (env as any).TELEGRAM_CHAT_ID || env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('[telegram] Missing TELEGRAM credentials');
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = new URLSearchParams({
    chat_id: String(chatId),
    text,
  });
  try {
    await fetch(url, { method: 'POST', body });
  } catch (err) {
    console.warn('[telegram] Failed to send message:', err);
  }
}
