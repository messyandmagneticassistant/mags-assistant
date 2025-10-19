import { presenceReport, Env } from './lib/env';
import { getRuntimeConfigSummary, hydrateEnvWithConfig } from './lib/config';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function handleDiagConfig(env: Env): Promise<Response> {
  try {
    let summary = getRuntimeConfigSummary(env);
    if (!summary) {
      summary = await hydrateEnvWithConfig(env);
    }

    const report = presenceReport(env);
    const { ok: _presenceOk, ...reportDetails } = report;

    const statusPrefix = summary.source === 'kv' ? '✅ Loaded config from KV' : '⚠️ Using environment fallback';

    return jsonResponse({
      ok: true,
      status: statusPrefix,
      source: summary.source,
      binding: summary.binding,
      key: summary.key,
      loadedAt: summary.loadedAt,
      bytes: summary.bytes,
      totalKeys: summary.keys.length,
      keys: summary.keys,
      warnings: summary.warnings,
      ...reportDetails,
    });
  } catch (err: any) {
    console.error('[/diag/config] crash:', err?.stack || err);
    return jsonResponse({ ok: false, status: '❌ diag-failed' }, 500);
  }
}
