import { runMaggieWorkflow } from './runMaggie';
import { loadSecretsFromBlob } from './utils/loadSecretsFromBlob';
import { postThread } from './postThread';

async function main() {
  try {
    // 🔐 Load all environment secrets from BLOB
    loadSecretsFromBlob();

    // 🚀 Run the full Maggie automation
    await runMaggieWorkflow();

    // ✅ Optional: Success message to PostQ
    await postThread({
      bot: {
        username: process.env.TIKTOK_PROFILE_MAGGIE!,
        session: process.env.TIKTOK_SESSION_MAGGIE!,
      },
      message: '✅ Maggie launched successfully from runner.ts.',
    });

  } catch (err: any) {
    console.error('[runner.ts] Error running Maggie:', err);
    await postThread({
      bot: {
        username: process.env.TIKTOK_PROFILE_MAGGIE!,
        session: process.env.TIKTOK_SESSION_MAGGIE!,
      },
      message: `❌ Maggie failed to launch: ${err.message || err}`,
    });
    process.exit(1);
  }
}

main();