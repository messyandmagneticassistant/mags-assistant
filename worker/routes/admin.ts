export async function onRequestGet({ env }: any) {
  const now = new Date();
  const emailCount = (await env.BRAIN.list({ prefix: 'email:inbox:' })).keys.length;
  const leadCount = (await env.BRAIN.list({ prefix: 'leads:' })).keys.length;
  const opsCount = ((await env.BRAIN.get('queue:ops', { type: 'json' })) || []).length;
  const tikTokCount = ((await env.BRAIN.get('tiktok:queue', { type: 'json' })) || []).length;
  const secrets = ['OPENAI_API_KEY','NOTION_API_KEY','STRIPE_SECRET_KEY','TALLY_SIGNING_SECRET','APPS_SCRIPT_WEBAPP_URL','BROWSERLESS_TOKEN'];
  const present = secrets.filter((k) => env[k]);
  const routesCount = 10;
  return new Response(
    JSON.stringify({ ok: true, now: now.toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, kvCounts: { emails: emailCount, leads: leadCount, queueOps: opsCount, queueTikTok: tikTokCount }, secretsPresent: present, routesCount }),
    { headers: { 'content-type': 'application/json' } }
  );
}

export async function onRequestPost({ request, env }: any) {
  const body = await request.json();
  if (body.kind === 'ops') {
    const mod: any = await import('./ops');
    await mod.runScheduled(null, env);
  }
  if (body.kind === 'tick') {
    try { const t: any = await import('./tiktok'); if (t.runScheduled) await t.runScheduled(null, env); } catch {}
  }
  if (body.kind === 'trends') {
    try { const t: any = await import('./tiktok'); if (t.refreshTrends) await t.refreshTrends(env); } catch {}
  }
  if (body.kind === 'plan') {
    await fetch(new URL('/planner/today', request.url).toString());
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
}
