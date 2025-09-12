import type { ExecutionContext } from "workerd";

type AnyObj = Record<string, any>;

const DEFAULT_SECRET_BLOB_KEY = "thread-state";
const DEFAULT_BRAIN_DOC_KEY = "PostQ:thread-state";

/**
 * Load configuration with this precedence:
 *   1) KV (BRAIN) → SECRET_BLOB / BRAIN_DOC_KEY
 *   2) env (CF Worker vars / CI-injected / .env)
 * KV wins so no renames/moves are required.
 */
export async function loadConfig(env: AnyObj): Promise<AnyObj> {
  const secretBlobKey = env.SECRET_BLOB || DEFAULT_SECRET_BLOB_KEY;
  const brainDocKey = env.BRAIN_DOC_KEY || DEFAULT_BRAIN_DOC_KEY;

  let kvData: AnyObj = {};
  let brainDoc = "";
  try {
    if (env.BRAIN && typeof env.BRAIN.get === "function") {
      const rawSecrets = await env.BRAIN.get(secretBlobKey);
      if (rawSecrets) kvData = JSON.parse(rawSecrets);
      brainDoc = (await env.BRAIN.get(brainDocKey)) || "";
    }
  } catch {
    // ignore; fallback to env
  }

  // Merge: KV overrides env
  return { ...env, ...kvData, brainDoc };
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
