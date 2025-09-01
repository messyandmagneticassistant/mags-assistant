import { getProfile } from '../tiktok/config';
import { postVideo } from '../tiktok/uploader';
import { like, comment } from '../tiktok/engage';

interface EnvWithQueue {
  ADMIN_KEY: string;
  BROWSERLESS_API_KEY: string;
  BROWSERLESS_BASE_URL?: string;
  TIKTOK_QUEUE: { send: (body: any) => Promise<void> };
  [key: string]: any;
}

async function requireAdmin(req: Request, env: EnvWithQueue) {
  const key = req.headers.get('X-ADMIN-KEY');
  if (!key || key !== env.ADMIN_KEY) {
    throw new Response('unauthorized', { status: 401 });
  }
}

export async function handleTikTok(request: Request, env: EnvWithQueue): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/tiktok/')) return null;
  try {
    await requireAdmin(request, env);
  } catch (e) {
    return e as Response;
  }

  if (request.method === 'POST' && url.pathname === '/tiktok/post') {
    const { profile, videoUrl, caption, tags } = await request.json();
    const p = getProfile(env, String(profile));
    if (!p) return new Response('unknown profile', { status: 400 });
    const postUrl = await postVideo({ profile: p, videoUrl, caption, tags: tags || [], env });
    return Response.json({ ok: true, url: postUrl });
  }

  if (request.method === 'POST' && url.pathname === '/tiktok/engage') {
    const { profile, targetUrl, action, commentText } = await request.json();
    const p = getProfile(env, String(profile));
    if (!p) return new Response('unknown profile', { status: 400 });
    if (action === 'like') await like({ profile: p, targetUrl, env });
    else if (action === 'comment') await comment({ profile: p, targetUrl, text: commentText || '', env });
    else return new Response('unknown action', { status: 400 });
    return Response.json({ ok: true });
  }

  if (request.method === 'POST' && url.pathname === '/tiktok/schedule') {
    const { jobs } = await request.json();
    for (const job of jobs as any[]) {
      await env.TIKTOK_QUEUE.send({ type: 'tiktok.post', ...job });
    }
    return Response.json({ ok: true, enqueued: jobs.length });
  }

  return new Response('not found', { status: 404 });
}
