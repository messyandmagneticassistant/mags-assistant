type AnyObj = Record<string, any>;

const DEFAULT_SECRET_BLOB = "thread-state";
const DEFAULT_BRAIN_DOC_KEY = "PostQ:thread-state";
const RUNTIME_CONFIG_SYMBOL = "__maggieRuntimeConfig";

export type ConfigHydrationSummary = {
  source: "kv" | "env";
  key: string | null;
  binding: string | null;
  keys: string[];
  bytes: number | null;
  warnings: string[];
  loadedAt: string;
};

type RuntimeConfigCache = {
  applied: boolean;
  config: AnyObj;
  summary: ConfigHydrationSummary;
};

function isKvNamespace(value: unknown): value is KVNamespace {
  return !!value && typeof value === "object" && typeof (value as KVNamespace).get === "function";
}

function resolveConfigKv(env: AnyObj): { binding: string; namespace: KVNamespace } | null {
  const candidates: Array<[string, unknown]> = [
    ["PostQ", env.PostQ],
    ["POSTQ", env.POSTQ],
    ["MAGGIE", env.MAGGIE],
    ["MAGGIE_KV", env.MAGGIE_KV],
    ["BRAIN", env.BRAIN],
  ];

  for (const [binding, candidate] of candidates) {
    if (isKvNamespace(candidate)) {
      return { binding, namespace: candidate };
    }
  }

  return null;
}

function buildCandidateKeys(env: AnyObj): string[] {
  const keys = new Set<string>();

  const maybeKeys = [
    env.POSTQ_THREAD_STATE_KEY,
    env.SECRET_BLOB,
    env.BRAIN_DOC_KEY,
    DEFAULT_BRAIN_DOC_KEY,
    DEFAULT_SECRET_BLOB,
    "PostQ:thread-state",
    "thread-state",
  ];

  for (const candidate of maybeKeys) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) keys.add(trimmed);
    }
  }

  return Array.from(keys);
}

async function readConfigFromKv(
  binding: string,
  kv: KVNamespace,
  keys: string[],
): Promise<{ config: AnyObj; key: string | null; bytes: number | null; warnings: string[] }> {
  const warnings: string[] = [];
  const encoder = new TextEncoder();

  for (const candidate of keys) {
    const key = candidate.trim();
    if (!key) continue;

    try {
      const raw = await kv.get(key, "text");
      if (typeof raw !== "string" || !raw.trim()) {
        continue;
      }

      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return {
            config: parsed as AnyObj,
            key,
            bytes: encoder.encode(raw).length,
            warnings,
          };
        }

        warnings.push(`Key ${key} in ${binding} is not a JSON object.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`Key ${key} in ${binding} is not valid JSON: ${message}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to read ${key} from ${binding}: ${message}`);
    }
  }

  warnings.push(`No config blob found in ${binding} for keys: ${keys.join(", ")}`);
  return { config: {}, key: null, bytes: null, warnings };
}

function collectEnvFallback(env: AnyObj): AnyObj {
  const snapshot: AnyObj = {};
  for (const [key, value] of Object.entries(env)) {
    if (key === RUNTIME_CONFIG_SYMBOL) continue;
    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean") {
      snapshot[key] = value;
    }
  }
  return snapshot;
}

export async function hydrateEnvWithConfig(env: AnyObj): Promise<ConfigHydrationSummary> {
  const runtimeEnv = env as AnyObj & { [RUNTIME_CONFIG_SYMBOL]?: RuntimeConfigCache };
  const cached = runtimeEnv[RUNTIME_CONFIG_SYMBOL];
  if (cached?.applied) {
    return cached.summary;
  }

  const timestamp = new Date().toISOString();
  const kvInfo = resolveConfigKv(env);
  const candidateKeys = buildCandidateKeys(env);

  let config: AnyObj = {};
  let key: string | null = null;
  let bytes: number | null = null;
  const warnings: string[] = [];
  const binding = kvInfo?.binding ?? null;
  let source: "kv" | "env" = "env";

  if (kvInfo) {
    const result = await readConfigFromKv(kvInfo.binding, kvInfo.namespace, candidateKeys);
    warnings.push(...result.warnings);
    if (result.key) {
      config = result.config;
      key = result.key;
      bytes = result.bytes;
      source = "kv";
    }
  } else {
    warnings.push("No KV namespace resolved for Maggie config.");
  }

  if (source === "kv") {
    Object.assign(env, config);
  }

  const fallbackSnapshot = source === "kv" ? null : collectEnvFallback(env);
  if (source !== "kv" && warnings.length === 0) {
    warnings.push("Using environment variables because no KV config was available.");
  }

  const summary: ConfigHydrationSummary = {
    source,
    key,
    binding,
    keys: source === "kv" ? Object.keys(config).sort() : Object.keys(fallbackSnapshot ?? {}).sort(),
    bytes,
    warnings,
    loadedAt: timestamp,
  };

  runtimeEnv[RUNTIME_CONFIG_SYMBOL] = { applied: true, config: source === "kv" ? config : {}, summary };
  return summary;
}

export function getRuntimeConfigSummary(env: AnyObj): ConfigHydrationSummary | null {
  const runtimeEnv = env as AnyObj & { [RUNTIME_CONFIG_SYMBOL]?: RuntimeConfigCache };
  return runtimeEnv[RUNTIME_CONFIG_SYMBOL]?.summary ?? null;
}

/**
 * Load configuration with this precedence:
 *   1) KV blob (PostQ/BRAIN)
 *   2) Environment variables
 */
export async function loadConfig(env: AnyObj): Promise<AnyObj> {
  await hydrateEnvWithConfig(env);
  const runtimeEnv = env as AnyObj & { [RUNTIME_CONFIG_SYMBOL]?: RuntimeConfigCache };
  const overrides = runtimeEnv[RUNTIME_CONFIG_SYMBOL]?.config ?? {};
  return { ...env, ...overrides };
}

export async function getSecrets(env: AnyObj): Promise<AnyObj> {
  const kvInfo = resolveConfigKv(env);
  if (!kvInfo) return {};

  const key = (typeof env.SECRET_BLOB === "string" && env.SECRET_BLOB.trim()) || DEFAULT_SECRET_BLOB;
  try {
    const raw = await kvInfo.namespace.get(key, "text");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function getBrainDoc(env: AnyObj): Promise<string> {
  const kvInfo = resolveConfigKv(env);
  if (!kvInfo) return "";

  const key = (typeof env.BRAIN_DOC_KEY === "string" && env.BRAIN_DOC_KEY.trim()) || DEFAULT_BRAIN_DOC_KEY;
  try {
    return (await kvInfo.namespace.get(key, "text")) ?? "";
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
