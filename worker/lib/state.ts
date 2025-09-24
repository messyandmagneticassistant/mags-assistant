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

export function normalizeTrends(trends: unknown): MaggieTrend[] | undefined {
  if (!Array.isArray(trends)) return undefined;
  const mapped = trends
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') {
        return { title: entry } satisfies MaggieTrend;
      }
      if (typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        const title = obj.title ?? obj.name ?? obj.caption;
        if (typeof title === 'string' && title.trim()) {
          return { ...obj, title: title.trim() } as MaggieTrend;
        }
        const url = typeof obj.url === 'string' ? obj.url : undefined;
        if (url) {
          return { ...obj, title: url } as MaggieTrend;
        }
      }
      return null;
    })
    .filter((value): value is MaggieTrend => Boolean(value));
  return mapped.length ? mapped : undefined;
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
