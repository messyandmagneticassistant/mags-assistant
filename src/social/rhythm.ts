import { kvKeys, getJSON } from './kv';

function mins(dt: Date) {
  return dt.getHours() * 60 + dt.getMinutes();
}

export async function scoreTimeSlot(env: any, dt: Date, profile: string): Promise<number> {
  const aw = await getJSON(env, kvKeys.audienceWindows, {} as any);
  const qh = await getJSON(env, kvKeys.quietHours, { tz: '', windows: [], soft: true } as any);
  const m = mins(dt);
  let mult = 1;

  const windows = (aw[profile] as any[]) || [];
  for (const w of windows) {
    if (m >= w.startMin && m <= w.endMin) {
      mult = Math.max(mult, w.weight || 1);
    }
  }

  const qWindows = qh.windows || [];
  for (const w of qWindows) {
    if (m >= w.startMin && m <= w.endMin) {
      return qh.soft ? mult * 0.5 : 0;
    }
  }

  return mult;
}

export async function canPostNow(env: any, dt: Date, profile: string, quotas: any): Promise<boolean> {
  const q = quotas[profile];
  if (!q) return true;
  const ledger = await getJSON(env, kvKeys.postLedger(profile), [] as any[]);
  const now = dt.getTime();

  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;
  const postsLastDay = ledger.filter((e) => now - (e.ts || 0) < day).length;
  if (q.dayCap && postsLastDay >= q.dayCap) return false;
  const postsLastHour = ledger.filter((e) => now - (e.ts || 0) < hour).length;
  if (q.hourCap && postsLastHour >= q.hourCap) return false;
  const last = ledger[ledger.length - 1];
  if (last && now - last.ts < (q.gapMin || 0) * 60000) return false;
  return true;
}
