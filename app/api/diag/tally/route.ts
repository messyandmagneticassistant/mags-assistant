import { env } from '../../../../lib/env.js';

export const runtime = 'nodejs';

export async function GET() {
  if (!env.TALLY_API_KEY)
    return Response.json({ ok: false, reason: 'missing TALLY_API_KEY' });
  try {
    const r = await fetch('https://api.tally.so/forms', {
      headers: { Authorization: `Bearer ${env.TALLY_API_KEY}` },
    });
    return Response.json({ ok: r.ok, reason: r.ok ? undefined : `status ${r.status}` });
  } catch (e: any) {
    return Response.json({ ok: false, reason: e.message });
  }
}

