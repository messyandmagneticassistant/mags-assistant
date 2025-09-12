// worker/health.ts
type DiagResult = {
  ok: boolean;
  notes: string[];
  errors: string[];
  kv: {
    binding: boolean;
    read: boolean;
    namespaceHint?: string;
  };
  keys: {
    blobKey: string;
    brainDocKey: string;
  };
  present: Record<string, boolean>;
};

export const diagConfig = async (_req: Request, env: any) => {
  const res: DiagResult = {
    ok: true,
    notes: [],
    errors: [],
    kv: { binding: false, read: false },
    keys: {
      blobKey: env?.SECRET_BLOB || "thread-state",
      brainDocKey: env?.BRAIN_DOC_KEY || "PostQ:thread-state",
    },
    present: {},
  };

  // 1) Ensure KV binding exists
  if (!env || !("BRAIN" in env) || !env.BRAIN) {
    res.ok = false;
    res.errors.push("KV binding 'BRAIN' is missing (check wrangler.toml).");
    return new Response(JSON.stringify(res), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }
  res.kv.binding = true;

  // 2) Try reading keys; never throw
  try {
    const [blob, brain] = await Promise.all([
      env.BRAIN.get(res.keys.blobKey, "text"),
      env.BRAIN.get(res.keys.brainDocKey, "text"),
    ]);
    res.kv.read = true;
    res.present[res.keys.blobKey] = !!blob;
    res.present[res.keys.brainDocKey] = !!brain;

    if (!blob) res.notes.push(`KV missing '${res.keys.blobKey}' (ok if not initialized).`);
    if (!brain) res.notes.push(`KV missing '${res.keys.brainDocKey}' (ok if not initialized).`);
  } catch (e: any) {
    res.ok = false;
    res.errors.push(`KV read failed: ${e?.message || String(e)}`);
  }

  return new Response(JSON.stringify(res), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
};