import fs from 'fs';
import path from 'path';
import { ensureSafe } from '../src/media/pipeline';

async function main() {
  const env = {
    BRAIN: {
      store: new Map<string, string>(),
      async get(key: string) { return this.store.get(key) || null; },
      async put(key: string, val: string) { this.store.set(key, val); },
      async delete(key: string) { this.store.delete(key); },
    },
  } as any;

  const queueFile = path.join(process.cwd(), 'tmp', 'queue.json');
  const queue: any[] = fs.existsSync(queueFile) ? JSON.parse(fs.readFileSync(queueFile, 'utf8')) : [];

  for (const item of queue.slice(0, 5)) {
    const local = item.file || item.path;
    if (!local) continue;
    const id = path.basename(local);
    const caption = item.caption || '';
    try {
      const report = await ensureSafe(env, { id, path: local, caption });
      console.log(`[batch] ${id}: ${report.status}`);
    } catch (err) {
      console.error('[batch] failed', id, err);
    }
  }
}

main();
