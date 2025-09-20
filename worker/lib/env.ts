export type Env = {
  BRAIN: KVNamespace;
  PostQ?: KVNamespace;
  SECRET_BLOB?: string;        // e.g., "thread-state"
  BRAIN_DOC_KEY?: string;      // e.g., "PostQ:thread-state"
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
