import { postThread } from '../postThread';
import { BotSession } from '../types';
import { uploadToTikTok } from './uploadToTikTok';

const BOOSTER_ACCOUNTS: BotSession[] = [
  {
    handle: '@messy.mars4',
    session: process.env.TIKTOK_SESSION_MARS!,
  },
  {
    handle: '@willowhazeltea',
    session: process.env.TIKTOK_SESSION_WILLOW!,
  },
  {
    handle: '@maggieassistant',
    session: process.env.TIKTOK_SESSION_MAGGIE!,
  },
];

export async function uploadForBoosters(config: Record<string, any> = {}) {
  for (const booster of BOOSTER_ACCOUNTS) {
    try {
      await postThread({
        bot: booster,
        message: `📤 Uploading from booster account ${booster.handle}...`,
      });

      const result = await uploadToTikTok(booster, {
        ...config,
        useCapCut: false, // already processed!
      });

      if (result.success) {
        await postThread({
          bot: booster,
          message: `🎉 Booster post uploaded: ${result.title}`,
        });
      }
    } catch (err) {
      console.error(`[uploadForBoosters] Failed for ${booster.handle}`, err);
      await postThread({
        bot: booster,
        message: `❌ Booster upload failed: ${err.message || err}`,
      });
    }
  }
}