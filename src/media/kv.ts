export const mediaKV = {
  report: (id: string) => `media:safety:report:${id}`,
  lock:   (id: string) => `media:safety:lock:${id}`,
  cache:  (id: string) => `media:safety:cache:${id}`,
};

export async function getJSON(env: any, key: string, fallback: any = null) {
  try {
    const v = await env.BRAIN.get(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
export async function setJSON(env: any, key: string, val: any) {
  await env.BRAIN.put(key, JSON.stringify(val));
}
