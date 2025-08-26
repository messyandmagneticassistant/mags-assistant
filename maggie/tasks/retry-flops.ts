// maggie/tasks/retry-flops.ts

import fs from 'fs/promises';
import path from 'path';
import { tgSend } from '../../lib/telegram';
import { log } from '../shared/logger';

const FLOP_THRESHOLD = 100; // Adjust based on your average views

export async function checkForFlops() {
  log('[flops] Checking for flops...');

  const flopsDir = path.resolve('flops');
  const retryDir = path.resolve('retry');

  try {
    await fs.mkdir(retryDir, { recursive: true });
    const files = await fs.readdir(flopsDir);

    if (files.length === 0) {
      log('[flops] No flops detected.');
      return;
    }

    for (const file of files) {
      const filePath = path.join(flopsDir, file);

      const { views = 0 } = parseMetadataFromFilename(file);
      if (views < FLOP_THRESHOLD) {
        const retryPath = path.join(retryDir, file);
        await fs.rename(filePath, retryPath);

        log(`[flops] Requeued flop: ${file} (views: ${views})`);
        await tgSend(`🌀 Requeued flop: <b>${file}</b> (views: ${views})`);
      } else {
        log(`[flops] Skipped (not flop): ${file} (views: ${views})`);
      }
    }
  } catch (err) {
    log(`[flops] Error checking for flops: ${err}`);
    await tgSend(`❌ Flop retry error:\n<code>${String(err)}</code>`);
  }
}

// Example: 'sunset-rabbit_54views.mp4' → { views: 54 }
function parseMetadataFromFilename(filename: string): { views?: number } {
  const match = filename.match(/_(\d+)views/i);
  return match ? { views: parseInt(match[1], 10) } : {};
}