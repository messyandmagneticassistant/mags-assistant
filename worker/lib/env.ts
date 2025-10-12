import type { BrainSyncEnv } from '../../lib/putConfig';

export type Env = BrainSyncEnv & {
  BRAIN: KVNamespace;
  PostQ?: KVNamespace;
  TELEGRAM_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  POST_THREAD_SECRET?: string;
  SECRET_BLOB?: string;        // e.g., "thread-state"
  BRAIN_DOC_KEY?: string;      // e.g., "PostQ:thread-state"
  THREAD_STATE_BRANCH?: string;
  THREAD_STATE_REPO?: string;
  THREAD_STATE_PATH?: string;
  BRAIN_DOC_GITHUB_PATH?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_TOKEN?: string;
  GITHUB_PAT?: string;
  GITHUB_REF_NAME?: string;
  POSTQ_KV_ID?: string;
  POSTQ_KV_NAMESPACE?: string;
  POSTQ_KV_TOKEN?: string;
  CODEX_SYNC_URL?: string;
  CODEX_ENDPOINT?: string;
  CODEX_LEARN_URL?: string;
  CODEX_AUTH_TOKEN?: string;
  CODEX_API_KEY?: string;
  CODEX_TOKEN?: string;
  CODEX_SYNC_KEY?: string;
  CODEX_SYNC_TOKEN?: string;
  CODEX_LEARN_KEY?: string;
  SYNC_KEY?: string;
  LEARN_URL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_API_BASE?: string;
  [k: string]: unknown;
};

export function presenceReport(env: Env) {
  const keys = ['SECRET_BLOB','BRAIN_DOC_KEY'];

  const hasBRAIN =
    !!env.BRAIN &&
    typeof (env.BRAIN as any).get === 'function' &&
    typeof (env.BRAIN as any).put === 'function';

  const vars: Record<string, boolean> = {};
  for (const k of keys) vars[k] = !!(env as any)[k];

  return { ok: true, bindings: { BRAIN: hasBRAIN }, vars };
}
