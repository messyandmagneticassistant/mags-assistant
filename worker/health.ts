import { presenceReport, Env } from './lib/env';

export async function handleHealth(env: Env): Promise<Response> {
  try {
    const report = presenceReport(env);
    return new Response(JSON.stringify({ ...report, ok: true }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[/health] crash:', err?.stack || err);
    return new Response(JSON.stringify({ ok: false, error: 'health-failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
