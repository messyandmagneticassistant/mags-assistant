import { runMaggie } from '../runMaggie.ts';
import { stopScheduler } from '../maggie/tasks/scheduler.ts';

async function main() {
  try {
    const report = await runMaggie({ force: true, log: true, source: 'boot-script' });
    console.log('\n[Maggie Boot] Final status report:\n', JSON.stringify(report, null, 2));
  } catch (err) {
    console.error('[Maggie Boot] Failed to run Maggie:', err instanceof Error ? err.message : err);
  } finally {
    stopScheduler();
    setTimeout(() => process.exit(0), 500);
  }
}

main().catch((err) => {
  console.error('[Maggie Boot] Unexpected error:', err);
  stopScheduler();
  setTimeout(() => process.exit(1), 500);
});
