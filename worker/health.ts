/**
 * /diag/config — basic env sanity check
 * Returns key names and presence flags (no secret values)
 */
export const diagConfig = (env: Record<string, any>) => {
  const kvKey = env.BRAIN_DOC_KEY || "PostQ:thread-state";

  return new Response(
    JSON.stringify({
      kvFirst: true,
      kvKey,
      present: {
        SECRET_BLOB: !!env.SECRET_BLOB,
        BRAIN_DOC_KEY: !!env.BRAIN_DOC_KEY,
      },
    }),
    { headers: { "content-type": "application/json" } }
  );
};

