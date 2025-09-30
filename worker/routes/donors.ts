import type { DonationInput } from '../../src/donors/notion';

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function parseDonationInput(raw: unknown): DonationInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const email = typeof value.email === 'string' ? value.email.trim() : '';
  const intent = typeof value.intent === 'string' ? value.intent.trim() : '';

  const amountValue = value.amount;
  const amount =
    typeof amountValue === 'number'
      ? amountValue
      : typeof amountValue === 'string' && amountValue.trim() !== ''
        ? Number(amountValue)
        : NaN;

  if (!name || !email || !intent || !Number.isFinite(amount)) {
    return null;
  }

  return {
    name,
    email,
    amount,
    intent,
  } satisfies DonationInput;
}

export async function onRequestGet({ env, request }: { env: any; request: Request }) {
  const url = new URL(request.url);
  if (url.pathname !== '/donors/recent') return json({ ok: false }, 404);
  try {
    // @ts-ignore - donation helpers are sourced from shared application code
    const { listRecentDonations } = await import('../../src/' + 'donors/notion');
    const list = await listRecentDonations(10, env);
    return json(list);
  } catch (e: any) {
    return json({ ok: false, error: e.message }, 500);
  }
}

export async function onRequestPost({ env, request }: { env: any; request: Request }) {
  const url = new URL(request.url);
  if (url.pathname !== '/donors/add') return json({ ok: false }, 404);
  if (request.headers.get('x-api-key') !== env.POST_THREAD_SECRET) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  const body = await request.json().catch(() => ({}));
  const input = parseDonationInput(body);
  if (!input) {
    return json({ ok: false, error: 'invalid-input' }, 400);
  }
  try {
    // @ts-ignore - donation helpers are sourced from shared application code
    const { recordDonation } = await import('../../src/' + 'donors/notion');
    await recordDonation(input, env);
    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: e.message }, 500);
  }
}
