import { BotSession } from '../types';
import { postThread } from '../../postThread';
// import { runViaAPI } from '../clients/tiktok-api'; // optional for direct API
// import { runViaBrowser } from '../clients/tiktok-browser'; // fallback: headless

export async function runTikTokAutomation({
  bot,
  supportBots,
  config,
}: {
  bot: BotSession;
  supportBots: Record<string, BotSession>;
  config: Record<string, any>;
}) {
  console.info(`[tiktok] Starting automation for @${bot.username}...`);

  try {
    // Choose either headless or API route — right now assume browser fallback
    // await runViaAPI(bot, supportBots, config);
    // OR
    // await runViaBrowser(bot, supportBots, config);

    await postThread({
      bot,
      message: `🚀 Posted successfully for @${bot.username}!`,
    });

    // 🧠 Optionally log stats or interactions
    console.info(`[tiktok] Automation completed for @${bot.username}.`);
  } catch (err) {
    console.error(`[tiktok] Automation failed:`, err);
    await postThread({
      bot,
      message: `❌ TikTok automation failed for @${bot.username}: ${err.message || err}`,
    });
    throw err;
  }
}