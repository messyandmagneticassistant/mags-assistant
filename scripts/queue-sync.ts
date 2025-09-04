import fs from 'fs';
import path from 'path';
import { scoreVariant } from '../src/social/score';

const editedDir = path.join(process.cwd(), 'work', 'edited');
const queuePath = path.join(process.cwd(), 'work', 'queue.json');
const queue: any[] = fs.existsSync(queuePath) ? JSON.parse(fs.readFileSync(queuePath, 'utf8')) : [];

for (const file of fs.readdirSync(editedDir)) {
  const filePath = path.join(editedDir, file);
  const score = scoreVariant(filePath);
  queue.push({ file: filePath, score });
}

fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
console.log('[queue-sync] queued', queue.length, 'items');
