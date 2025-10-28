import { checkBrainDrift } from './brainPing';

async function main() {
  try {
    const report = await checkBrainDrift();
    if (!report.matches) {
      console.error('[brain:check] ❌ Drift detected between Git and Cloudflare KV.');
      console.error(JSON.stringify(report, null, 2));
      process.exit(1);
    }

    console.log('[brain:check] ✅ Brain is in sync with Cloudflare KV.');
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error('[brain:check] ❌ Unable to complete drift check.');
    console.error(err);
    process.exit(1);
  }
}

main();
