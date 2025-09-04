export async function enqueue(env: any, job: any) {
  const key = 'queue:ops';
  const arr = (await env.BRAIN.get(key, { type: 'json' })) || [];
  arr.push({ ...job, ts: Date.now() });
  await env.BRAIN.put(key, JSON.stringify(arr));
}

export async function dequeue(env: any, max = 3) {
  const key = 'queue:ops';
  const arr = (await env.BRAIN.get(key, { type: 'json' })) || [];
  const jobs = arr.splice(0, max);
  await env.BRAIN.put(key, JSON.stringify(arr));
  return jobs;
}
