import fs from 'fs';
import path from 'path';
import { putConfig } from '../lib/kv';

const KV_KEY = 'PostQ:thread-state';

async function loadBrainConfig(filePath: string): Promise<string> {
  const raw = await fs.promises.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const next = { ...parsed } as Record<string, any>;
    if (next.lastUpdated === 'auto') {
      next.lastUpdated = new Date().toISOString();
    }
    return JSON.stringify(next, null, 2);
  }

  return JSON.stringify(parsed);
}

async function main() {
  const kvPath = path.join(process.cwd(), 'config', 'kv-state.json');
  let serialized: string;

  try {
    serialized = await loadBrainConfig(kvPath);
  } catch (err) {
    console.error(`Failed to read or parse ${kvPath}:`, err);
    process.exit(1);
  }

  const result = await putConfig(KV_KEY, serialized);

  console.log(
    `✅ Synced brain to KV (namespace ${result.namespaceId}, key ${result.key})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
