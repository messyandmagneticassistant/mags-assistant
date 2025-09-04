import fs from 'fs';
import path from 'path';
import { burnInCaptions } from '../src/social/captions';
import { classifyFrame, redactRegions } from '../src/social/safety';

const incomingDir = path.join(process.cwd(), 'work', 'incoming');
const editedDir = path.join(process.cwd(), 'work', 'edited');
fs.mkdirSync(editedDir, { recursive: true });

const files = fs.readdirSync(incomingDir).filter(f => f.endsWith('.mp4'));

for (const file of files) {
  const src = path.join(incomingDir, file);
  const dest = path.join(editedDir, file);
  // TODO: real video editing pipeline
  fs.copyFileSync(src, dest);
  burnInCaptions(dest, []);
  console.log('[video-doctor] processed %s', file);
}
