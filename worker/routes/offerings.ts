import { listOfferings } from '../../src/commerce/products';

export async function onRequestGet() {
  return new Response(JSON.stringify(listOfferings(), null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
