// maggie/launch.ts

import { loadSecretsFromBlob } from '../utils/loadSecretsFromBlob';
import { dispatch } from './intent-router';
import { runMaggie } from './index';
import { tgSend } from '../lib/telegram'; // Adjust path if needed

// 🧠 Entry point for Maggie's daily cycle
async function main() {
  try {
    await loadSecretsFromBlob();

    const input = process.argv.slice(2).join(' ').trim();

    if (input) {
      console.log('[launch] Dispatching input:', input);
      await tgSend(`🟢 CLI Input Detected: "${input}" — Dispatching now...`);
      await dispatch(input, { source: 'cli' });
    } else {
      console.log('[launch] No input provided. Running Maggie default cycle...');
      await tgSend(`⚙️ No input provided — Maggie launching default cycle.`);
      await runMaggie({ force: false });
    }
  } catch (err) {
    console.error('[launch] Fatal error:', err);
    await tgSend(`❌ Maggie failed during launch: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main();