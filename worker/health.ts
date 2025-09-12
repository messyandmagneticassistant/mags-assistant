type Env = Record<string, any>;

/**
 * /diag/config — sanity check for config key presence
 */
export const diagConfig = (env: Env) => {
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
