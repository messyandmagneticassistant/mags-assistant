import { notionUpsert, driveUpload } from '../../src/ops/sync';

export async function onRequestPost({ request, env }: any) {
  const { pathname } = new URL(request.url);
  const body = await request.json();
  if (pathname === '/sync/notion') {
    const r = await notionUpsert(env, body);
    return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } });
  }
  if (pathname === '/sync/drive') {
    const r = await driveUpload(env, body);
    return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } });
  }
  return new Response('not found', { status: 404 });
}
