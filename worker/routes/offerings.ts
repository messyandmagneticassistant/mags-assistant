export async function onRequestGet() {
  // @ts-ignore - worker shares product catalog from app bundle
  const { listOfferings } = await import('../../src/' + 'commerce/products');
  return new Response(JSON.stringify(await listOfferings(), null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
