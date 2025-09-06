import fs from 'fs';
import path from 'path';
import { schedule } from './scheduler';

// choose a directory for transient CI artifacts
const QUEUE_DIR = process.env.QUEUE_DIR ?? 'tmp';
const queuePath = path.join(process.cwd(), QUEUE_DIR, 'queue.json');

const dryrun = process.argv.includes('--dryrun');

async function main() {
  const queue: any[] = fs.existsSync(queuePath) ? JSON.parse(fs.readFileSync(queuePath, 'utf8')) : [];
  for (const item of queue) {
    if (item.scheduled) continue;
    const when = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    if (!dryrun) await schedule({ fileUrl: item.file, caption: '', whenISO: when });
    item.scheduled = when;
    console.log('[orchestrate] scheduled', item.file, 'at', when);
  }
  if (!dryrun) {
    fs.mkdirSync(path.dirname(queuePath), { recursive: true });
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  }
}

main();
