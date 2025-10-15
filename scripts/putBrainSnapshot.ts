import { putBrainSnapshot } from '../lib/putConfig';

async function run() {
  try {
    const result = await putBrainSnapshot(process.env as Record<string, unknown>);
    if (result.ok) {
      console.log('[putBrainSnapshot] ✅ Snapshot synced', {
        syncedAt: result.syncedAt ?? null,
        bytes: result.bytes ?? null,
        warnings: result.warnings ?? [],
      });
      process.exit(0);
    }

    console.error('[putBrainSnapshot] ⚠️ Snapshot skipped or failed', result);
    process.exit(result.skipped ? 0 : 1);
  } catch (err) {
    console.error('[putBrainSnapshot] ❌ Unexpected error', err);
    process.exit(1);
  }
}

run();
