// maggie/tasks/retry-flops.ts

import fs from 'fs/promises';
import path from 'path';
import { tgSend } from '../../lib/telegram';
import { log } from '../shared/logger';

const FLOP_THRESHOLD = 100; // adjust based on your avg views (e.g., 100 = low view count)

export async function checkForFlops() {
  log('[flops] Checking for flops...');

  const flopsDir = path.resolve('flops');
  const retryDir = path.resolve('retry');

  try {
    const files = await fs.readdir(flopsDir);

    for (const file of files) {
      const filePath = path.join(flopsDir, file);

      // Simulate detection logic (e.g., views under threshold)
      const { views = 0 } = parseMetadataFromFilename(file);
      if (views < FLOP_THRESHOLD) {
        const retryPath = path.join(retryDir, file);
        await fs.rename(filePath, retryPath);

        log(`[flops] Requeued flop: ${file} (views: ${views})`);
        await tgSend(`🌀 Requeued flop: <b>${file}</b> (views: ${views})`);
      }
    }
  } catch (err) {
    log(`[flops] Error checking for flops: ${err}`);
    await tgSend(`❌ Flop retry error:\n<code>${String(err)}</code>`);
  }
}

function parseMetadataFromFilename(filename: string): { views?: number } {
  // Example: 'my-video_37views.mp4' → { views: 37 }
  const match = filename.match(/_(\d+)views/i);
  return match ? { views: parseInt(match[1], 10) } : {};
}