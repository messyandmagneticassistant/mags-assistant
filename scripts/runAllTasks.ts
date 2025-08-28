// scripts/runAllTasks.ts

import { readTasks } from '../lib/task'
import { runTaskQueue } from '../lib/codex'

async function runAll() {
  const tasks = await readTasks()

  if (tasks.length === 0) {
    console.warn('⚠️ No tasks found to run. You may need to generate them first.')
    return
  }

  for (const task of tasks) {
    try {
      console.log(`\n🧠 Running Task: ${task.name}`)
      const result = await runTaskQueue(task)
      console.log(`✅ Finished: ${task.name}\nResult:\n${result}`)
    } catch (error: any) {
      console.error(`❌ Failed task: ${task.name}`, error.message)
    }
  }

  console.log('🎯 All tasks completed.')
}

runAll().catch((err) => {
  console.error('❌ Fatal error running tasks:', err)
})