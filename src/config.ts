export async function getSecrets(env: any) {
  const k = env.SECRET_BLOB || 'thread-state';
  const v = await env.BRAIN.get(k);
  return v ? JSON.parse(v) : {};
}

export async function getBrainDoc(env: any) {
  const k = env.BRAIN_DOC_KEY || 'PostQ:thread-state';
  return (await env.BRAIN.get(k)) || '';
}
