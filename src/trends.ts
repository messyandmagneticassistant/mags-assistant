export async function refreshTrends(env: any) {
  const data = { ts: Date.now(), items: [] };
  await env.POSTQ.put('tiktok:trends', JSON.stringify(data));
  await env.POSTQ.put('tiktok:trends:ts', String(data.ts));
  return data;
}
