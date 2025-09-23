import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { getConfigValue } from '../../lib/kv';

export interface ThreadStateSnapshot {
  raw: string;
  json: any | null;
}

export interface ThreadStateValueDescriptor {
  name: string;
  keys: string[];
  pathIncludes?: string[];
  rawKeys?: string[];
}

const DEFAULT_SNAPSHOT_CANDIDATES: (string | undefined)[] = [
  process.env.THREAD_STATE_SNAPSHOT_PATH,
  'config/thread-state.remote.json',
  'config/kv-state.json',
];

async function readIfExists(candidate?: string): Promise<string | null> {
  if (!candidate) return null;
  try {
    const resolved = path.resolve(candidate);
    await access(resolved);
    return await readFile(resolved, 'utf8');
  } catch {
    return null;
  }
}

function parseJson(raw: string): any | null {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function candidateMatches(keyLower: string, candidateLower: string): boolean {
  if (candidateLower === '*') return true;
  if (candidateLower.startsWith('*') && candidateLower.endsWith('*')) {
    return keyLower.includes(candidateLower.slice(1, -1));
  }
  if (candidateLower.startsWith('*')) {
    return keyLower.endsWith(candidateLower.slice(1));
  }
  if (candidateLower.endsWith('*')) {
    return keyLower.startsWith(candidateLower.slice(0, -1));
  }
  return keyLower === candidateLower;
}

function searchJsonValue(
  json: any,
  candidates: string[],
  pathIncludes: string[] = [],
): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const normalizedCandidates = candidates.map((value) => value.toLowerCase());
  const pathNeedles = pathIncludes.map((value) => value.toLowerCase());
  const seen = new WeakSet<object>();

  const visit = (node: any, pathParts: string[]): string | undefined => {
    if (!node || typeof node !== 'object') return undefined;
    if (seen.has(node)) return undefined;
    seen.add(node);

    for (const [key, value] of Object.entries(node)) {
      const nextPath = [...pathParts, key];
      const keyLower = key.toLowerCase();
      const pathLower = nextPath.map((part) => part.toLowerCase());
      const pathMatches =
        !pathNeedles.length || pathNeedles.every((needle) => pathLower.some((part) => part.includes(needle)));

      if (typeof value === 'string') {
        if (pathMatches) {
          for (const candidate of normalizedCandidates) {
            if (candidateMatches(keyLower, candidate)) {
              return value;
            }
          }
        }
      } else if (typeof value === 'object' && value) {
        const result = visit(value, nextPath);
        if (result !== undefined) return result;
      }
    }

    return undefined;
  };

  return visit(json, []);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function searchRawValue(raw: string, keys: string[]): string | undefined {
  if (!raw.trim()) return undefined;
  for (const key of keys) {
    const pattern = new RegExp(`${escapeRegExp(key)}\s*[:=]\s*["'`]?([^"'`\s]+)`, 'i');
    const match = pattern.exec(raw);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

export async function loadThreadStateSnapshot(): Promise<ThreadStateSnapshot> {
  for (const candidate of DEFAULT_SNAPSHOT_CANDIDATES) {
    const raw = await readIfExists(candidate);
    if (raw !== null) {
      return { raw, json: parseJson(raw) };
    }
  }

  const kvKeys = ['PostQ:thread-state', 'thread-state'];
  for (const key of kvKeys) {
    try {
      const value = await getConfigValue<string>(key);
      if (typeof value === 'string') {
        return { raw: value, json: parseJson(value) };
      }
    } catch (err) {
      console.warn(`[thread-state] Unable to load "${key}" from KV:`, err instanceof Error ? err.message : err);
    }
  }

  return { raw: '', json: null };
}

export function extractValues(
  snapshot: ThreadStateSnapshot,
  descriptors: ThreadStateValueDescriptor[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const descriptor of descriptors) {
    const { name, keys, pathIncludes = [], rawKeys } = descriptor;
    let resolved: string | undefined;

    if (snapshot.json) {
      resolved = searchJsonValue(snapshot.json, keys, pathIncludes);
    }

    if (!resolved && snapshot.raw) {
      resolved = searchRawValue(snapshot.raw, rawKeys ?? keys);
    }

    if (resolved) {
      values[name] = resolved;
    }
  }
  return values;
}

const DEFAULT_DESCRIPTORS: ThreadStateValueDescriptor[] = [
  {
    name: 'TELEGRAM_BOT_TOKEN',
    keys: ['TELEGRAM_BOT_TOKEN', 'telegramBotToken', '*token'],
    pathIncludes: ['telegram'],
  },
  {
    name: 'TELEGRAM_CHAT_ID',
    keys: ['TELEGRAM_CHAT_ID', 'telegramChatId', '*chat*'],
    pathIncludes: ['telegram'],
  },
  {
    name: 'STRIPE_SECRET_KEY',
    keys: ['STRIPE_SECRET_KEY', 'stripeSecretKey'],
    pathIncludes: ['stripe'],
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET',
    keys: ['STRIPE_WEBHOOK_SECRET', 'stripeWebhookSecret'],
    pathIncludes: ['stripe'],
  },
  {
    name: 'TALLY_API_KEY',
    keys: ['TALLY_API_KEY', 'tallyApiKey'],
    pathIncludes: ['tally'],
  },
  {
    name: 'TALLY_SIGNING_SECRET',
    keys: ['TALLY_SIGNING_SECRET', 'tallySigningSecret'],
    pathIncludes: ['tally'],
  },
  {
    name: 'NOTION_TOKEN',
    keys: ['NOTION_TOKEN', 'notionToken'],
    pathIncludes: ['notion'],
  },
  {
    name: 'NOTION_API_KEY',
    keys: ['NOTION_API_KEY', 'notionApiKey'],
    pathIncludes: ['notion'],
  },
  {
    name: 'GOOGLE_CLIENT_EMAIL',
    keys: ['GOOGLE_CLIENT_EMAIL', 'clientEmail'],
    pathIncludes: ['google', 'service'],
  },
  {
    name: 'GOOGLE_PRIVATE_KEY',
    keys: ['GOOGLE_PRIVATE_KEY', 'privateKey'],
    pathIncludes: ['google', 'service'],
  },
  {
    name: 'GOOGLE_KEY_URL',
    keys: ['GOOGLE_KEY_URL', 'keyUrl'],
    pathIncludes: ['google'],
  },
  {
    name: 'FETCH_PASS',
    keys: ['FETCH_PASS', 'fetchPass'],
  },
  {
    name: 'WORKER_URL',
    keys: ['WORKER_URL', 'workerUrl'],
  },
  {
    name: 'WORKER_BASE_URL',
    keys: ['WORKER_BASE_URL', 'workerBaseUrl'],
  },
  {
    name: 'TIKTOK_SESSION_MAGGIE',
    keys: ['TIKTOK_SESSION_MAGGIE', 'sessionMaggie'],
    pathIncludes: ['tiktok'],
  },
  {
    name: 'TIKTOK_SESSION_MAIN',
    keys: ['TIKTOK_SESSION_MAIN', 'sessionMain'],
    pathIncludes: ['tiktok'],
  },
  {
    name: 'TIKTOK_SESSION_WILLOW',
    keys: ['TIKTOK_SESSION_WILLOW', 'sessionWillow'],
    pathIncludes: ['tiktok'],
  },
  {
    name: 'TIKTOK_SESSION_MARS',
    keys: ['TIKTOK_SESSION_MARS', 'sessionMars'],
    pathIncludes: ['tiktok'],
  },
  {
    name: 'TIKTOK_PROFILE_MAGGIE',
    keys: ['TIKTOK_PROFILE_MAGGIE', 'profileMaggie'],
    pathIncludes: ['tiktok'],
  },
  {
    name: 'TIKTOK_PROFILE_MAIN',
    keys: ['TIKTOK_PROFILE_MAIN', 'profileMain'],
    pathIncludes: ['tiktok'],
  },
  {
    name: 'TIKTOK_PROFILE_WILLOW',
    keys: ['TIKTOK_PROFILE_WILLOW', 'profileWillow'],
    pathIncludes: ['tiktok'],
  },
  {
    name: 'TIKTOK_PROFILE_MARS',
    keys: ['TIKTOK_PROFILE_MARS', 'profileMars'],
    pathIncludes: ['tiktok'],
  },
];

export async function hydrateEnvFromThreadState(
  descriptors: ThreadStateValueDescriptor[] = DEFAULT_DESCRIPTORS,
): Promise<Record<string, string>> {
  const snapshot = await loadThreadStateSnapshot();
  if (!snapshot.raw) return {};
  const values = extractValues(snapshot, descriptors);
  for (const [key, value] of Object.entries(values)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
  return values;
}

export async function resolveThreadStateValue(
  descriptor: ThreadStateValueDescriptor,
): Promise<string | undefined> {
  const snapshot = await loadThreadStateSnapshot();
  if (!snapshot.raw) return undefined;
  const values = extractValues(snapshot, [descriptor]);
  return values[descriptor.name];
}

