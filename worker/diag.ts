import type { Env } from './lib/env';

const REQUIRED_KEYS = [
  'STRIPE_API_KEY',
  'TIKTOK_SESSION_MAIN',
  'TIKTOK_PROFILE_MAIN',
  'TALLY_FORM_ID',
  'TELEGRAM_BOT_TOKEN',
  'BROWSERLESS_API_KEY',
  'NOTION_API_KEY',
] as const;

type RequiredKey = (typeof REQUIRED_KEYS)[number];

type ConfigCheckResult = {
  valid: boolean;
  missing_keys: RequiredKey[];
};

function jsonResponse(body: ConfigCheckResult, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function resolveConfigKV(env: Env): KVNamespace | null {
  const candidate =
    (env as Record<string, unknown>).PostQ ??
    (env as Record<string, unknown>).POSTQ ??
    env.BRAIN;

  if (candidate && typeof (candidate as KVNamespace).get === 'function') {
    return candidate as KVNamespace;
  }

  return null;
}

function parseConfig(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function hasRequiredKey(config: Record<string, unknown>, key: RequiredKey): boolean {
  if (config[key]) return true;

  const nestedSources = [config.env, config.secrets, config.config];
  for (const source of nestedSources) {
    if (source && typeof source === 'object' && (source as Record<string, unknown>)[key]) {
      return true;
    }
  }

  return false;
}

export async function handleDiagConfig(env: Env): Promise<Response> {
  const kv = resolveConfigKV(env);
  if (!kv) {
    return jsonResponse({ valid: false, missing_keys: [...REQUIRED_KEYS] });
  }

  const keyName = env.BRAIN_DOC_KEY || 'PostQ:thread-state';
  const raw = await kv.get(keyName);
  const config = parseConfig(raw);

  if (!config) {
    return jsonResponse({ valid: false, missing_keys: [...REQUIRED_KEYS] });
  }

  const missing = REQUIRED_KEYS.filter((key) => !hasRequiredKey(config, key));

  return jsonResponse({ valid: missing.length === 0, missing_keys: missing });
}
