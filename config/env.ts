const DEFAULT_THREAD_STATE_KEY = 'PostQ:thread-state';
const FALLBACK_THREAD_STATE_KEY = 'thread-state';

const DEFAULT_ACCOUNT_ID = '5ff52dc210a86ff34a0dd3664bacb237';
const DEFAULT_NAMESPACE_ID = '1b8cbbc4a2f8426194368cb39baded79';
const DEFAULT_API_TOKEN = 'VN6bJbdN5WWlKWtnF50BGuTVdX8Twxx4WwJYtKqF';

function clean(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export const threadStateKey =
  clean(process.env.POSTQ_THREAD_STATE_KEY) ||
  clean(process.env.THREAD_STATE_KEY) ||
  DEFAULT_THREAD_STATE_KEY;

export const fallbackThreadStateKey =
  clean(process.env.THREAD_STATE_FALLBACK_KEY) ||
  clean(process.env.THREAD_STATE_KEY_FALLBACK) ||
  FALLBACK_THREAD_STATE_KEY;

export const cloudflareAccountId =
  clean(process.env.CLOUDFLARE_ACCOUNT_ID) ||
  clean(process.env.CF_ACCOUNT_ID) ||
  clean(process.env.ACCOUNT_ID) ||
  DEFAULT_ACCOUNT_ID;

export const cloudflareNamespaceId =
  clean(process.env.CF_KV_POSTQ_NAMESPACE_ID) ||
  clean(process.env.CLOUDFLARE_NAMESPACE_ID) ||
  clean(process.env.CF_KV_NAMESPACE_ID) ||
  DEFAULT_NAMESPACE_ID;

export const cloudflareApiToken =
  clean(process.env.CLOUDFLARE_API_TOKEN) ||
  clean(process.env.CLOUDFLARE_TOKEN) ||
  clean(process.env.CF_API_TOKEN) ||
  clean(process.env.API_TOKEN) ||
  DEFAULT_API_TOKEN;

export const threadStateFallbackPaths = [
  'config/thread-state.json',
  'brain/brain.json',
];

export type ThreadStateEnvConfig = {
  key: string;
  fallbackKey: string;
  accountId: string;
  namespaceId: string;
  apiToken: string;
  fallbackPaths: string[];
};

export function resolveThreadStateEnv(): ThreadStateEnvConfig {
  return {
    key: threadStateKey,
    fallbackKey: fallbackThreadStateKey,
    accountId: cloudflareAccountId,
    namespaceId: cloudflareNamespaceId,
    apiToken: cloudflareApiToken,
    fallbackPaths: threadStateFallbackPaths,
  };
}
