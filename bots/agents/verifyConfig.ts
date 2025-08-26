// bots/agents/verifyConfig.ts

import { loadConfigFromKV } from '@/utils/loadConfigFromKV';
import { threadStateKey } from '@/config/env';
import { postTelegram } from '../utils/notifyTelegram'; // Optional: Only if you're using Telegram notifications

export async function verifyConfig() {
  const config = await loadConfigFromKV(threadStateKey);

  if (!config) {
    const msg = '❌ Failed to load config from thread-state.';
    console.error(msg);
    await postTelegram?.(msg);
    return;
  }

  const maggie = config.agents?.maggie;

  if (!maggie) {
    const msg = '⚠️ Maggie not found in agents config.';
    console.warn(msg);
    await postTelegram?.(msg);
  } else {
    const msg = '✅ Maggie config loaded successfully.';
    console.log(msg);
    console.dir(maggie, { depth: null });
    await postTelegram?.(msg);
  }
}