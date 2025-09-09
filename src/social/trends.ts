import { kvKeys, getJSON, setJSON } from './kv';
import { scoreTimeSlot, canPostNow } from './rhythm';

export async function refreshTrends(env: any) {
  // Pull existing raw trends; if missing, stub with empty array
  const raw = await getJSON(env, 'tiktok:trends:raw', [] as any[]);
  const now = Date.now();
  const scored = raw.map((t: any, idx: number) => {
    const recency = Math.exp(-((now - (t.updatedAt || now)) / (60 * 60 * 1000)));
    const volume = t.volume || 1;
    const nicheFit = t.nicheFit || 1;
    const safe = t.safe === false ? 0 : 1;
    const season = t.seasonal || 1;
    const score = recency * volume * nicheFit * safe * season;
    return { id: t.id || idx, hashtag: t.hashtag, soundId: t.soundId, score, decayAt: now + 6 * 60 * 60 * 1000 };
  });
  await setJSON(env, kvKeys.trendScores, scored);
  await env.BRAIN.put('tiktok:trends:updatedAt', String(now));
  return scored;
}

export async function nextOpportunities(env: any, now: Date, profile: string) {
  const trends = await getJSON(env, kvKeys.trendScores, [] as any[]);
  const ledger = await getJSON(env, kvKeys.postLedger(profile), [] as any[]);
  const used = new Set(ledger.map((l: any) => l.id));
  const quotas = await getJSON(env, kvKeys.quotas, {} as any);
  if (!(await canPostNow(env, now, profile, quotas))) return [];
  const mult = await scoreTimeSlot(env, now, profile);
  return trends
    .filter((t: any) => t.decayAt > now.getTime() && !used.has(t.id))
    .map((t: any) => ({ ...t, score: t.score * mult }))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 3);
}
