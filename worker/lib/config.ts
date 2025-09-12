import type { ExecutionContext } from "workerd";

type AnyObj = Record<string, any>;

const DEFAULT_SECRET_BLOB = "thread-state";
const DEFAULT_BRAIN_DOC_KEY = "PostQ:thread-state";

/**
 * Load configuration with this precedence:
 *   1) KV (BRAIN) → key from SECRET_BLOB or default "thread-state"
 *   2) env (CF Worker vars / CI-injected / .env)
 * KV wins so no renames/moves are required.
 */
export async function loadConfig(env: AnyObj): Promise<AnyObj> {
  const secretBlobKey = env.SECRET_BLOB || DEFAULT_SECRET_BLOB;

  let kvData: AnyObj = {};
  try {
    if (env.BRAIN && typeof env.BRAIN.get === "function") {
      const raw = await env.BRAIN.get(secretBlobKey);
      if (raw) kvData = JSON.parse(raw);
    }
  } catch {
    // ignore; fallback to env
  }

  // Merge: KV overrides env
  return { ...env, ...kvData };
}

export async function getSecrets(env: AnyObj): Promise<AnyObj> {
  const key = env.SECRET_BLOB || DEFAULT_SECRET_BLOB;
  try {
    const raw = await env.BRAIN.get(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function getBrainDoc(env: AnyObj): Promise<string> {
  const key = env.BRAIN_DOC_KEY || DEFAULT_BRAIN_DOC_KEY;
  try {
    return (await env.BRAIN.get(key)) || "";
  } catch {
    return "";
  }
}

/** Presence map without leaking values */
export function presence(cfg: AnyObj, keys: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of keys) out[k] = !!cfg[k];
  return out;
}

/** Accept multiple admin key names to match existing setups */
export function getAdminKey(cfg: AnyObj): string | undefined {
  return cfg.ADMIN_KEY || cfg.WORKER_CRON_KEY || cfg.POST_THREAD_SECRET;
}
