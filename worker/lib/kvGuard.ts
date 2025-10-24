import { isKvWriteAllowed, describeKvWriteState } from '../../shared/kvWrites';
import type { Env } from './env';

type AnyEnv = Env & Record<string, unknown>;

type KvLike = { put?: (...args: any[]) => Promise<any> | any } & Record<string, unknown>;

const GUARD_SYMBOL = Symbol.for('maggie.kvGuardApplied');

function createGuardedBinding(binding: KvLike, name: string): KvLike {
  const proxy = Object.create(binding);
  proxy.put = async (...args: any[]) => {
    const key = args.length > 0 ? args[0] : '(unknown)';
    console.warn(`[kvGuard] Blocked KV.put on ${name} for key ${String(key)} (writes disabled).`);
    return { ok: false, skipped: true, reason: 'kv-writes-disabled' } as const;
  };
  return proxy;
}

export function applyKvWriteGuards(env: AnyEnv): void {
  if (!env || typeof env !== 'object') return;
  const runtime = env as AnyEnv & { [GUARD_SYMBOL]?: string };
  if (runtime[GUARD_SYMBOL]) return;

  const secondary = typeof process === 'undefined' ? undefined : process.env;
  const allowed = isKvWriteAllowed(env, secondary);
  runtime[GUARD_SYMBOL] = describeKvWriteState(env, secondary);
  if (allowed) {
    return;
  }

  for (const key of Object.keys(env)) {
    const candidate = env[key];
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as KvLike;
    if (typeof record.put === 'function') {
      env[key] = createGuardedBinding(record, key) as any;
    }
  }
}

