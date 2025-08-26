// maggie/tasks/watch-raw.ts

import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs/promises';
import { log } from '../shared/logger';
import { createQueuedPost } from '../core/createQueuedPost';
import { tgSend } from '../../lib/telegram';

const DROP_FOLDER = 'drop';

export function watchRawFolder() {
  const watcher = chokidar.watch(DROP_FOLDER, { ignoreInitial: true });

  watcher.on('add', async (filePath) => {
    log(`[watch-raw] New file detected: ${filePath}`);

    try {
      const ext = path.extname(filePath).toLowerCase();
      if (!['.mp4', '.mov', '.webm'].includes(ext)) {
        log(`[watch-raw] Skipping unsupported file: ${filePath}`);
        return;
      }

      const filename = path.basename(filePath);
      const queued = await createQueuedPost({ path: filePath, originalName: filename });

      log(`[watch-raw] Queued new post: ${queued.title}`);
      await tgSend(`📥 New video dropped & queued:\n<b>${queued.title}</b>`);
    } catch (err) {
      log(`[watch-raw] Error handling file: ${filePath} → ${err}`);
      await tgSend(`❌ Drop file error:\n<code>${String(err)}</code>`);
    }
  });

  watcher.on('error', (err) => {
    log(`[watch-raw] Watcher error: ${err}`);
  });

  log(`[watch-raw] Watching "${DROP_FOLDER}" for new files...`);
}