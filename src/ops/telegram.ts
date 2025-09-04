export async function handleUpdate(update: any, env: any, req: Request) {
  const message = update.message?.text || '';
  const chatId = update.message?.chat?.id;
  if (!message || !chatId) return { ok: false };
  const origin = new URL(req.url).origin;
  const send = async (text: string) =>
    fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  const [cmd, ...rest] = message.split(' ');
  if (cmd === '/status') {
    const r = await fetch(origin + '/admin/status');
    const txt = await r.text();
    await send(txt);
  } else if (cmd === '/plan') {
    const r = await fetch(origin + '/planner/today');
    await send(r.ok ? await r.text() : 'no plan yet');
  } else if (cmd === '/post') {
    const handle = rest.shift();
    const url = rest.shift();
    const caption = rest.join(' ');
    await fetch(origin + '/tiktok/post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle, url, caption }),
    });
    await send('posted');
  } else if (cmd === '/boost') {
    const postUrl = rest.shift();
    const boosters = (await env.BRAIN.get('thread-state:boosters', { type: 'json' }))?.boosters || [];
    await fetch(origin + '/tiktok/eng/orchestrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postUrl, boosters }),
    });
    await send('boosting');
  }
  return { ok: true };
}
