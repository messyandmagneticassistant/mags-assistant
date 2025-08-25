import { runMaggieUpdater } from './runner';
import { fileURLToPath } from 'url';
import { loadSecretsFromBlob } from './utils/loadSecretsFromBlob';
import { runMaggieTikTokLoop } from './src/automation/maggie-tiktok';
import { runGoogleSheetSync } from './src/automation/google-sheet-sync';
import { runStripeSync } from './src/automation/stripe-sync';
import { runNotionTasks } from './src/automation/notion-tasks';
import { postThread } from './postThread';

loadSecretsFromBlob(); // ⬅️ Load SECRETS_BLOB into process.env

const sessions = {
  main: {
    username: process.env.TIKTOK_PROFILE_MAIN,
    session: process.env.TIKTOK_SESSION_MAIN,
  },
  willow: {
    username: process.env.TIKTOK_PROFILE_WILLOW,
    session: process.env.TIKTOK_SESSION_WILLOW,
  },
  maggie: {
    username: process.env.TIKTOK_PROFILE_MAGGIE,
    session: process.env.TIKTOK_SESSION_MAGGIE,
  },
  mars: {
    username: process.env.TIKTOK_PROFILE_MARS,
    session: process.env.TIKTOK_SESSION_MARS,
  }
};

const DEFAULT_BOT = sessions.maggie;

export async function runFullWorkflow(config: Record<string, any>) {
  await runMaggieTikTokLoop(
    {
      bot: DEFAULT_BOT,
      supportBots: {
        willow: sessions.willow,
        mars: sessions.mars,
        main: sessions.main,
      },
    },
    config
  );

  await runGoogleSheetSync(config);
  await runStripeSync(config);
  await runNotionTasks(config);
}

export async function runMaggieWorkflow() {
  try {
    const config = process.env; // Already populated by loadSecretsFromBlob()
    await runFullWorkflow(config);

    // 🧠 Optional: post system success back to PostQ thread log
    await postThread({
      bot: DEFAULT_BOT,
      message: '✅ Maggie workflow completed successfully.',
    });

  } catch (err) {
    console.error('[runMaggie] fatal error:', err);
    await postThread({
      bot: DEFAULT_BOT,
      message: `❌ Maggie workflow failed: ${err.message || err}`,
    });
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMaggieWorkflow();
}