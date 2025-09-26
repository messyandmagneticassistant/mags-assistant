import { printBundle, type PrintBundlePayload } from '../../src/fulfillment/print-bundle';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

export async function onRequestOptions() {
  return new Response('', { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }: { request: Request; env: any }) {
  const body = (await request.json().catch(() => ({}))) as PrintBundlePayload;
  try {
    const result = await printBundle(body, env);
    return json({ ok: true, result });
  } catch (err: any) {
    const message = err?.message || 'Unable to generate printable layout';
    console.warn('[print-bundle] request failed:', err);
    return json({ ok: false, error: message }, /missing|invalid|must/i.test(message) ? 400 : 500);
  }
}

