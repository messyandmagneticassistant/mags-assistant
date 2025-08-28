// maggie/tasks/scheduler.ts

import { readTasks, writeTasks, Task } from '../../lib/task.js'
import { runTaskQueue } from '../../lib/codex.js'
import { postNextVideo } from './post-next.js'
import { tgSend } from '../../lib/telegram.js'
import { formatTask } from '../../lib/helpers/formatTask.js'

const POST_INTERVAL_MS = parseInt(process.env.POST_INTERVAL_MS || '180000', 10) // 3 minutes default
let isRunning = false

/**
 * 🧠 Runs Codex automation queue first, then starts auto-post loop
 */
export async function runFullScheduler() {
  if (isRunning) return
  isRunning = true

  console.log('\n🚀 Maggie Task Scheduler Booting Up...\n')
  await tgSend('🧠 Maggie is activating: Running tasks + infinite post loop...')

  await runCodexQueue()
  await startAutoPostingLoop()
}

/**
 * 🛠 Process Codex task queue one by one
 */
async function runCodexQueue() {
  const tasks = await readTasks()

  if (!tasks.length) {
    console.log('📭 No queued Codex tasks.')
    return
  }

  for (const task of tasks) {
    try {
      console.log(formatTask(task))

      const result = await runTaskQueue(task)

      task.metadata = {
        ...(task.metadata || {}),
        lastRun: new Date().toISOString(),
        result: result?.slice?.(0, 500) || '[no result or truncated]',
      }

      console.log(`✅ Codex task complete: ${task.name}`)
    } catch (err: any) {
      console.error(`❌ Codex task error "${task.name}":`, err.message)
    }
  }

  await writeTasks(tasks)
  console.log('✅ All Codex tasks processed.\n')
}

/**
 * 🔁 Infinite post loop for TikTok uploads
 */
async function startAutoPostingLoop() {
  console.log('📹 Starting Maggie’s auto-posting loop...')
  await tgSend('📹 Maggie’s TikTok auto-posting loop is now active.')

  while (true) {
    try {
      const result = await postNextVideo()

      if (result?.success) {
        console.log(`[post-loop] ✅ Posted: ${result.title}`)
        await tgSend(`✅ Maggie posted:\n<b>${result.title}</b>`)
      } else {
        console.warn('[post-loop] ⚠️ Nothing to post right now.')
        await tgSend('⚠️ Maggie found nothing to post. Will retry.')
      }
    } catch (err: any) {
      console.error('[post-loop] ❌ Error:', err)
      await tgSend(`❌ Maggie post error:\n<code>${String(err)}</code>`)
    }

    await sleep(POST_INTERVAL_MS)
  }
}

/**
 * 💤 Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 🧪 Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runFullScheduler()
}