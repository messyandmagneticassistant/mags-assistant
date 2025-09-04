import fs from 'fs';
import path from 'path';
import { schedule } from './scheduler';

const dryrun = process.argv.includes('--dryrun');
const queuePath = path.join(process.cwd(), 'work', 'queue.json');

async function main() {
  const queue: any[] = fs.existsSync(queuePath) ? JSON.parse(fs.readFileSync(queuePath, 'utf8')) : [];
  for (const item of queue) {
    if (item.scheduled) continue;
    const when = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    if (!dryrun) await schedule({ fileUrl: item.file, caption: '', whenISO: when });
    item.scheduled = when;
    console.log('[orchestrate] scheduled', item.file, 'at', when);
  }
  if (!dryrun) fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
}

main();
