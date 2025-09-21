import { putConfig } from '../lib/kv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function updateBrain() {
  const filePath = path.join(__dirname, '../config/kv-state.json');

  try {
    const json = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(json);

    const result = await putConfig('thread-state', data);
    console.log('✅ Synced to Cloudflare KV:', result);
  } catch (err) {
    console.error('❌ Failed to update Maggie brain:', err);
  }
}

updateBrain();
