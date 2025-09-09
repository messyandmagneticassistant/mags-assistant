import { kvKeys, getJSON, setJSON } from './kv';

export async function pickVariant(env: any, testId: string) {
  const tests = await getJSON(env, kvKeys.abTests, [] as any[]);
  const t = tests.find((x) => x.id === testId);
  if (!t) return null;
  const choice = Math.random() < 0.5 ? 'A' : 'B';
  return { id: testId, variant: choice, value: choice === 'A' ? t.variantA : t.variantB };
}

export async function recordOutcome(env: any, testId: string, variant: string, metrics: any) {
  const tests = await getJSON(env, kvKeys.abTests, [] as any[]);
  const idx = tests.findIndex((x) => x.id === testId);
  if (idx === -1) return;
  const t = tests[idx];
  t.results = t.results || {};
  t.results[variant] = t.results[variant] || [];
  t.results[variant].push(metrics);
  tests[idx] = t;
  await setJSON(env, kvKeys.abTests, tests);
}
