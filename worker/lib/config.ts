type AnyObj = Record<string, any>;

/**
 * Load configuration from KV first, falling back to env values.
 * Secrets are stored in BRAIN under the key from SECRET_BLOB
 * (defaulting to "thread-state").
 */
export async function loadConfig(env: AnyObj): Promise<AnyObj> {
  const raw = await env.BRAIN.get(env.SECRET_BLOB || "thread-state", "text");
  const secrets = raw ? JSON.parse(raw) : {};
  return { ...env, ...secrets };
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
