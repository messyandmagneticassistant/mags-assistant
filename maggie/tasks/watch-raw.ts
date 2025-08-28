import chokidar from 'chokidar'
import path from 'path'
import fs from 'fs/promises'
import { log } from '../shared/logger'
import { createQueuedPost } from '../core/createQueuedPost'
import { tgSend } from '../../lib/telegram'
import { tryDownloadCapCutVersion } from './capcut-handler'

const DROP_FOLDER = 'drop'
const SUPPORTED_EXTENSIONS = ['.mp4', '.mov', '.webm']

/**
 * Starts watching the raw video drop folder for new files.
 * When a video file is added, it gets queued for Maggie to post.
 */
export function watchRawFolder(): void {
  const watcher = chokidar.watch(DROP_FOLDER, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100
    }
  })

  watcher.on('add', async (filePath: string) => {
    log(`[watch-raw] 🎬 New file detected: ${filePath}`)

    try {
      const ext = path.extname(filePath).toLowerCase()
      if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        log(`[watch-raw] ⛔ Unsupported file type: ${ext}. Skipping.`)
        return
      }

      const filename = path.basename(filePath)

      // Try to get CapCut-enhanced version
      const capcutVersion = await tryDownloadCapCutVersion(filePath)
      const finalPath = capcutVersion || filePath

      const queued = await createQueuedPost({
        path: finalPath,
        originalName: filename
      })

      log(`[watch-raw] ✅ Queued new post: ${queued.title}`)
      await tgSend(`📥 Maggie queued a new video:\n<b>${queued.title}</b>`)
    } catch (err) {
      log(`[watch-raw] ❌ Error queuing video: ${filePath}\n→ ${err}`)
      await tgSend(`❌ Maggie hit an error with a drop file:\n<code>${String(err)}</code>`)
    }
  })

  watcher.on('error', (err) => {
    log(`[watch-raw] 🔥 Watcher error: ${err}`)
  })

  log(`[watch-raw] 👀 Watching "${DROP_FOLDER}" for incoming videos...`)
}