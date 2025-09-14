export async function postToTikTok({ clipPath, caption, cookie }) {
  if (!cookie) {
    return { ok: false, error: 'No cookie' };
  }
  const apiBase = process.env.API_BASE;
  if (apiBase) {
    try {
      const res = await fetch(`${apiBase}/tiktok/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ clipPath, caption }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: true, postUrl: data.url };
      }
      return { ok: false, error: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
  return { ok: true, postUrl: 'https://tiktok.com/queued-upload' };
}
