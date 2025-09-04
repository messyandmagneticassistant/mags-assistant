import fs from 'fs';
import path from 'path';

const id = process.argv[2];
const reviewPath = path.join(process.cwd(), 'work', 'review.json');
const queuePath = path.join(process.cwd(), 'work', 'queue.json');

const review: any[] = fs.existsSync(reviewPath) ? JSON.parse(fs.readFileSync(reviewPath, 'utf8')) : [];
const queue: any[] = fs.existsSync(queuePath) ? JSON.parse(fs.readFileSync(queuePath, 'utf8')) : [];

const idx = review.findIndex(r => r.id === id);
if (idx !== -1) {
  const item = review.splice(idx, 1)[0];
  queue.push(item);
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2));
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  console.log('[review-approve] moved', id);
} else {
  console.log('[review-approve] not found', id);
}
