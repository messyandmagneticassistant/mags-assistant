import { BotSession } from '../types';
import { postThread } from '../../postThread';
import { boostPostWithAlts } from '../clients/tiktok-boost';

export async function boostWithAlts(
  bot: BotSession,
  supportBots: Record<string, BotSession>,
  config: Record<string, any> = {}
): Promise<{
  success: boolean;
  summary: string;
}> {
  try {
    await postThread({
      bot,
      message: '🚀 Booster accounts engaging with main post...',
    });

    const boostResult = await boostPostWithAlts(bot, supportBots);

    if (!boostResult?.success) {
      throw new Error(boostResult?.error || 'Booster run failed or returned no result');
    }

    const summary = boostResult.summary || 'All boosters engaged';

    await postThread({
      bot,
      message: `✅ Boost complete: ${summary}`,
    });

    return {
      success: true,
      summary,
    };
  } catch (err) {
    const errorMsg = err.message || 'Unknown boost error';
    console.error('[boostWithAlts] failed:', err);

    await postThread({
      bot,
      message: `❌ Boosters failed: ${errorMsg}`,
    });

    return {
      success: false,
      summary: errorMsg,
    };
  }
}