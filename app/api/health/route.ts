import { env } from '../../../lib/env.js';

export const runtime = 'nodejs';

export async function GET() {
  const base = env.GOOGLE_KEY_URL ? env.GOOGLE_KEY_URL.replace(/\/mags-key$/, '') : '';
  const out: Record<string, string | boolean> = { ok: true };
  try {
    const r1 = await fetch(`${base}/health`);
    out.worker = r1.ok ? 'ok' : `status ${r1.status}`;
  } catch {
    out.worker = 'error';
  }
  try {
    const r2 = await fetch(env.GOOGLE_KEY_URL || '', {
      headers: { Authorization: `Bearer ${env.FETCH_PASS || ''}` },
    });
    const txt = await r2.text();
    out.key = r2.ok && txt.trim() ? 'ok' : `status ${r2.status}`;
  } catch {
    out.key = 'error';
  }
  return Response.json(out);
}
