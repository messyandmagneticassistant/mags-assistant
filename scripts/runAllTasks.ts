// scripts/runAllTasks.ts

import { readTasks } from '../lib/task.js'
import { runTaskQueue } from '../lib/codex.js'

/**
 * Run all tasks in the task queue using Codex.
 */
async function runAllTasks() {
  console.log('🔁 Loading tasks...')
  const tasks = await readTasks()

  if (tasks.length === 0) {
    console.log('⚠️ No tasks found in tasks.json')
    return
  }

  for (const task of tasks) {
    console.log(`\n🚀 Running task: ${task.name} (${task.type})`)
    try {
      await runTaskQueue(task)
    } catch (err: any) {
      console.error(`❌ Failed to run task ${task.name}:`, err.message)
    }
  }

  console.log('\n✅ All tasks complete.')
}

runAllTasks()