// 📍 File: maggie/launch.ts

import { loadSecretsFromBlob } from '../utils/loadSecretsFromBlob';
import { dispatch } from './intent-router';
import { runMaggie } from './index';
import { reportStatus } from '../lib/reportStatus'; // 🔔 Replaces tgSend

// 🧠 Entry point for Maggie's daily cycle
async function main() {
  try {
    await loadSecretsFromBlob();

    const input = process.argv.slice(2).join(' ').trim();

    if (input) {
      console.log('[launch] Dispatching input:', input);
      await reportStatus(`🟢 <b>CLI Input Detected</b>: <code>${input}</code> — Dispatching now...`);
      await dispatch(input, { source: 'cli' });
    } else {
      console.log('[launch] No input provided. Running Maggie default cycle...');
      await reportStatus(`⚙️ <b>No input provided</b> — Maggie launching default cycle.`);
      await runMaggie({ force: false });
    }
  } catch (err) {
    console.error('[launch] Fatal error:', err);
    await reportStatus(`❌ <b>Maggie failed during launch</b>: <code>${err instanceof Error ? err.message : String(err)}</code>`);
  }
}

main();