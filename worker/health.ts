/**
 * /diag/config — sanity check for config
 * Returns key names and basic presence flags
 */
export const diagConfig = async (env: Env) => {
  const secretBlobKey = env.SECRET_BLOB;
  const brainDocKey = env.BRAIN_DOC_KEY;

  let kvReadOk = false;
  try {
    kvReadOk = !!(await env.BRAIN_DOC_KV.get(brainDocKey));
  } catch {}

  const cfg = await loadConfig(env);

  const secrets = await getSecrets(env);
  const brainDoc = await getBrainDoc(env);

  const present = presence(cfg, secrets);

  return new Response(
    JSON.stringify({
      present,
      secretBlobKey,
      brainDocKey,
      hasSecrets: Object.keys(secrets).length > 0,
      brainDocBytes: brainDoc ? brainDoc.length : 0,
    }),
    { headers: { "content-type": "application/json" } }
  );
};