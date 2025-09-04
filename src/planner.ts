export async function runPlanner(env: any, _opts: any) {
  const plan = { ts: Date.now(), jobs: [] };
  await env.POSTQ.put('tiktok:plan:today', JSON.stringify(plan));
  return plan;
}

export async function getTodayPlan(env: any) {
  const raw = await env.POSTQ.get('tiktok:plan:today');
  return raw ? JSON.parse(raw) : null;
}
