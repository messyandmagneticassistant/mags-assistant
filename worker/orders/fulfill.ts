import { OrderContext } from '../../src/forms/schema';

export async function onRequestPost({ request }: { request: Request }) {
  const ctx = (await request.json().catch(() => null)) as OrderContext | null;
  console.log('fulfill', ctx);
  return new Response('ok', { status: 200 });
}
