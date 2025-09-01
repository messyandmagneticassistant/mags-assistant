import type { ExecutionContext } from "workerd";

type AnyObj = Record<string, any>;

const DEFAULT_KV_KEY = "thread-state";

/**
 * Load configuration with this precedence:
 *   1) KV (POSTQ) → key from SECRET_BLOB "PostQ:<key>" or default "thread-state"
 *   2) env (CF Worker vars / CI-injected / .env)
 * KV wins so no renames/moves are required.
 */
export async function loadConfig(env: AnyObj): Promise<AnyObj> {
  let kvKey = DEFAULT_KV_KEY;

  if (typeof env.SECRET_BLOB === "string") {
    const [ns, key] = env.SECRET_BLOB.split(":");
    if ((ns || "").toLowerCase() === "postq" && key) kvKey = key;
  }

  let kvData: AnyObj = {};
  try {
    if (env.POSTQ && typeof env.POSTQ.get === "function") {
      const raw = await env.POSTQ.get(kvKey);
      if (raw) kvData = JSON.parse(raw);
    }
  } catch {
    // ignore; fallback to env
  }

  // Merge: KV overrides env
  return { ...env, ...kvData };
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
