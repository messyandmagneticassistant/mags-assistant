export async function handleInbound(job: any, env: any) {
  const key = `email:inbox:${job.id}`;
  const item = await env.BRAIN.get(key, { type: 'json' });
  if (!item) return;
  let reply = 'Thanks for reaching out!';
  if (env.OPENAI_API_KEY) {
    try {
      const tone = (await env.BRAIN.get('thread-state:persona', { type: 'json' }))?.tone || 'friendly';
      const prompt = `Reply in a ${tone} tone to: ${item.text || item.subject}`;
      const r = await fetch('https://api.openai.com/v1/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ model: 'gpt-3.5-turbo-instruct', prompt, max_tokens: 100 }),
      });
      const data = await r.json();
      reply = data.choices?.[0]?.text?.trim() || reply;
    } catch {}
  }
  item.reply = reply;
  await env.BRAIN.put(key, JSON.stringify(item));
}

export async function sendReply(env: any, body: any) {
  const url = env.APPS_SCRIPT_WEBAPP_URL;
  if (!url) return { ok: false, message: 'apps script missing' };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok };
}
