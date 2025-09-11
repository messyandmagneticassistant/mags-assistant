import { getSecrets, getBrainDoc } from "../src/config";

export const onRequestGet = async ({ env }: any) => {
  return new Response(JSON.stringify({ ok: true, time: new Date().toISOString() }), {
    headers: { "content-type": "application/json" },
  });
};

/**
 * /diag/config — sanity check for KV wiring.
 * Returns key names and basic presence metrics.
 */
export const diagConfig = async ({ env }: any) => {
  const secretBlobKey = env.SECRET_BLOB || "thread-state";
  const brainDocKey = env.BRAIN_DOC_KEY || "PostQ:thread-state";

  const secrets = await getSecrets(env);
  const brainDoc = await getBrainDoc(env);

  return new Response(
    JSON.stringify({
      secretBlobKey,
      brainDocKey,
      hasSecrets: Object.keys(secrets).length > 0,
      brainDocBytes: brainDoc ? brainDoc.length : 0,
    }),
    { headers: { "content-type": "application/json" } }
  );
};
