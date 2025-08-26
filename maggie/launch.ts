// maggie/launch.ts

import { loadSecretsFromBlob } from '../utils/loadSecretsFromBlob';
import { dispatch } from './intent-router';
import { runMaggie } from './index';

// 🧠 Entry point for Maggie's daily cycle
async function main() {
  try {
    await loadSecretsFromBlob();

    const input = process.argv.slice(2).join(' ').trim();

    if (input) {
      console.log('[launch] Dispatching input:', input);
      await dispatch(input, { source: 'cli' });
    } else {
      console.log('[launch] No input provided. Running Maggie default cycle...');
      await runMaggie({ force: false });
    }
  } catch (err) {
    console.error('[launch] Fatal error:', err);
  }
}

main();