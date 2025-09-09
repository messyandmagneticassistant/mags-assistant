import { kvKeys, getJSON, setJSON } from './kv';

export const DEFAULTS = {
  quotas: {
    MAIN: { dayCap: 26, hourCap: 3, gapMin: 18 },
    WILLOW: { dayCap: 10, hourCap: 2, gapMin: 20 },
    MAGGIE: { dayCap: 10, hourCap: 2, gapMin: 20 },
    MARS: { dayCap: 10, hourCap: 2, gapMin: 20 },
  },
  audienceWindows: {
    MAIN: [
      { startMin: 7 * 60 + 10, endMin: 9 * 60 + 20, weight: 1.15 },
      { startMin: 12 * 60, endMin: 14 * 60, weight: 1.2 },
      { startMin: 18 * 60 + 30, endMin: 22 * 60 + 30, weight: 1.3 },
    ],
    WILLOW: [
      { startMin: 8 * 60, endMin: 10 * 60, weight: 1.1 },
      { startMin: 17 * 60, endMin: 21 * 60, weight: 1.2 },
    ],
    MAGGIE: [
      { startMin: 9 * 60, endMin: 11 * 60 + 30, weight: 1.1 },
      { startMin: 19 * 60, endMin: 22 * 60, weight: 1.2 },
    ],
    MARS: [
      { startMin: 7 * 60 + 30, endMin: 9 * 60, weight: 1.05 },
      { startMin: 20 * 60, endMin: 23 * 60, weight: 1.25 },
    ],
  },
  quietHours: { tz: 'America/Los_Angeles', windows: [{ startMin: 1 * 60, endMin: 6 * 60 }], soft: true },
  boostRules: {
    helperActions: [
      { atMin: 3, actions: ['like', 'save', 'copylink'] },
      { atMin: 5, actions: ['comment:hookA'] },
      { atMin: 12, actions: ['comment:hookB'] },
      { atMin: 22, actions: ['comment:question'] },
    ],
    randomnessSec: 90,
  },
};

export async function ensureDefaults(env: any) {
  for (const key of ['quotas', 'audienceWindows', 'quietHours', 'boostRules'] as const) {
    const kvKey = (kvKeys as any)[key];
    const existing = await env.BRAIN.get(kvKey);
    if (!existing) {
      await setJSON(env, kvKey, (DEFAULTS as any)[key]);
    }
  }

  const snapshot: any = {};
  for (const key of ['quotas', 'audienceWindows', 'quietHours', 'boostRules'] as const) {
    const kvKey = (kvKeys as any)[key];
    snapshot[key] = await getJSON(env, kvKey, (DEFAULTS as any)[key]);
  }
  return snapshot;
}
