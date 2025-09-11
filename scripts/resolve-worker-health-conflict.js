#!/usr/bin/env node
import fs from 'node:fs';

const file = process.argv[2];
if (!file) process.exit(0);

let content = fs.readFileSync(file, 'utf8');

// If we detect conflict markers or old key names, replace with canonical function
if (content.includes('<<<<<<<') || content.includes('blobKey') || content.includes('brainKey')) {
  const resolved = `/**
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
`;
  fs.writeFileSync(file, resolved, 'utf8');
}
