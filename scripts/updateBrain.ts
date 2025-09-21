import fs from 'fs';
import path from 'path';

import { putConfig } from '../lib/kv';

async function main() {
  const kvPath = path.join(process.cwd(), 'config', 'kv-state.json');
  let payload: unknown;

  try {
    const raw = await fs.promises.readFile(kvPath, 'utf8');
    payload = JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to read or parse ${kvPath}.`);
    console.error(err);
    process.exit(1);
  }

  try {
    await putConfig('PostQ:thread-state', payload, {
      contentType: 'application/json',
    });
    console.log(
      '✅ Synced PostQ:thread-state from config/kv-state.json to Cloudflare KV.'
    );
  } catch (err) {
    console.error('❌ Failed to sync Maggie brain config to Cloudflare KV.');
    if (err instanceof Error) {
      console.error(err.message);
      if (err.message.includes('credentials')) {
        console.error(
          'Double-check CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and CF_KV_POSTQ_NAMESPACE_ID.'
        );
      }
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

main();
