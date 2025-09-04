import { handleUpdate } from '../../src/ops/telegram';

export async function onRequestPost({ request, env }: any) {
  const update = await request.json();
  await handleUpdate(update, env, request);
  return new Response('ok');
}
