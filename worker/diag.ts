import { presenceReport, Env } from './lib/env';

export async function handleDiagConfig(env: Env): Promise<Response> {
  try {
    const report = presenceReport(env);

    let brainDocBytes: number | null = null;
    let secretBlobBytes: number | null = null;

    if (report.bindings.BRAIN) {
      if (env.BRAIN_DOC_KEY) {
        const v = await env.BRAIN.get(env.BRAIN_DOC_KEY);
        brainDocBytes = v ? new TextEncoder().encode(v).length : 0;
      }
      if (env.SECRET_BLOB) {
        const s = await env.BRAIN.get(env.SECRET_BLOB);
        secretBlobBytes = s ? new TextEncoder().encode(s).length : 0;
      }
    }

    return new Response(
      JSON.stringify({
        ...report,
        ok: true,
        kv: {
          probed: report.bindings.BRAIN,
          brainDocKey: env.BRAIN_DOC_KEY || null,
          brainDocBytes,
          secretBlobKey: env.SECRET_BLOB || null,
          secretBlobBytes,
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[/diag/config] crash:', err?.stack || err);
    return new Response(JSON.stringify({ ok: false, error: 'diag-failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
