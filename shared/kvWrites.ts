const truthyValues = new Set(['1', 'true', 'yes', 'on', 'enable', 'enabled']);
const falsyValues = new Set(['0', 'false', 'no', 'off', 'disable', 'disabled']);

type AnyRecord = Record<string, unknown> | undefined | null;

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return undefined;
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (truthyValues.has(normalized)) return true;
    if (falsyValues.has(normalized)) return false;
  }
  return undefined;
}

function extractFlag(source: AnyRecord, key: string): boolean | undefined {
  if (!source) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return parseBoolean(value);
}

function resolveEnvFlag(key: string): boolean | undefined {
  if (typeof process === 'undefined' || typeof process.env === 'undefined') {
    return undefined;
  }
  return parseBoolean(process.env[key]);
}

export function isKvWriteAllowed(primary?: AnyRecord, secondary?: AnyRecord): boolean {
  const disablePrimary = extractFlag(primary, 'DISABLE_KV_WRITES');
  if (disablePrimary !== undefined) return !disablePrimary;

  const disableSecondary = extractFlag(secondary, 'DISABLE_KV_WRITES');
  if (disableSecondary !== undefined) return !disableSecondary;

  const disableEnv = resolveEnvFlag('DISABLE_KV_WRITES');
  if (disableEnv !== undefined) return !disableEnv;

  const allowPrimary = extractFlag(primary, 'ALLOW_KV_WRITES');
  if (allowPrimary !== undefined) return allowPrimary;

  const allowSecondary = extractFlag(secondary, 'ALLOW_KV_WRITES');
  if (allowSecondary !== undefined) return allowSecondary;

  const allowEnv = resolveEnvFlag('ALLOW_KV_WRITES');
  if (allowEnv !== undefined) return allowEnv;

  return false;
}

export function describeKvWriteState(primary?: AnyRecord, secondary?: AnyRecord): string {
  const allowed = isKvWriteAllowed(primary, secondary);
  return allowed ? 'enabled' : 'disabled';
}

