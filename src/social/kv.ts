export const kvKeys = {
  trendScores: 'tiktok:trends:scores',
  audienceWindows: 'tiktok:aud:windows',
  postLedger: (profile: string) => `tiktok:post:ledger:${profile}`,
  abTests: 'tiktok:ab:matrix',
  quotas: 'tiktok:quotas',
  quietHours: 'tiktok:quiet',
  boostRules: 'tiktok:boost:rules',
  draftQueue: 'tiktok:drafts',
  health: 'tiktok:health',
};

export async function getJSON<T>(env: any, key: string, fallback: T): Promise<T> {
  try {
    const v = await env.BRAIN.get(key);
    if (!v) return fallback;
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

export async function setJSON(env: any, key: string, val: any) {
  try {
    await env.BRAIN.put(key, JSON.stringify(val));
  } catch {}
}

export async function pushLedger(env: any, profile: string, entry: any) {
  const key = kvKeys.postLedger(profile);
  const ledger = await getJSON(env, key, [] as any[]);
  ledger.push({ ...entry, ts: Date.now() });
  await setJSON(env, key, ledger);
}
