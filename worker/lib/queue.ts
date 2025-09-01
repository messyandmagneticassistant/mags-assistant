export interface QueueEnv {
  BRAIN: KVNamespace;
}

export interface QueueItem {
  type: string;
  payload: any;
}

const MAIN_KEY = 'q:main';
const LOCK_KEY = 'q:lock';

async function withLock<T>(env: QueueEnv, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  while (true) {
    const locked = await env.BRAIN.get(LOCK_KEY);
    if (!locked) {
      await env.BRAIN.put(LOCK_KEY, String(Date.now()), { expirationTtl: 30 });
      break;
    }
    if (Date.now() - start > 1000) {
      throw new Error('lock timeout');
    }
    await new Promise((res) => setTimeout(res, 50));
  }
  try {
    return await fn();
  } finally {
    await env.BRAIN.delete(LOCK_KEY).catch(() => {});
  }
}

export async function enqueue(env: QueueEnv, type: string, payload: any) {
  await withLock(env, async () => {
    const raw = (await env.BRAIN.get(MAIN_KEY)) || '[]';
    const list: QueueItem[] = JSON.parse(raw);
    list.push({ type, payload });
    await env.BRAIN.put(MAIN_KEY, JSON.stringify(list));
  });
}

export async function dequeue(env: QueueEnv): Promise<QueueItem[]> {
  return withLock(env, async () => {
    const raw = (await env.BRAIN.get(MAIN_KEY)) || '[]';
    const list: QueueItem[] = JSON.parse(raw);
    const items = list.splice(0, 5); // process max 5 items per tick
    await env.BRAIN.put(MAIN_KEY, JSON.stringify(list));
    return items;
  });
}

export async function size(env: QueueEnv): Promise<number> {
  const raw = (await env.BRAIN.get(MAIN_KEY)) || '[]';
  try {
    const list: QueueItem[] = JSON.parse(raw);
    return list.length;
  } catch {
    return 0;
  }
}
