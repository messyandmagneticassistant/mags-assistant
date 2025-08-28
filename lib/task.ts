// lib/task.ts

import fs from 'fs/promises'
import path from 'path'

/**
 * Task Type Interface
 */
export interface Task {
  name: string
  type: string
  priority?: number
  context?: string
  metadata?: Record<string, any>
}

/**
 * Loads tasks from tasks.json file in root.
 */
export async function readTasks(): Promise<Task[]> {
  const tasksPath = path.resolve('./tasks.json')

  try {
    const file = await fs.readFile(tasksPath, 'utf-8')
    const tasks: Task[] = JSON.parse(file)

    console.log(`✅ Loaded ${tasks.length} tasks from tasks.json`)
    return tasks
  } catch (e: any) {
    console.warn(`⚠️ No tasks file found at ${tasksPath}. Returning empty list.`)
    return []
  }
}

/**
 * Utility to save tasks back to file (if needed)
 */
export async function writeTasks(tasks: Task[]): Promise<void> {
  const tasksPath = path.resolve('./tasks.json')

  try {
    await fs.writeFile(tasksPath, JSON.stringify(tasks, null, 2), 'utf-8')
    console.log(`💾 Saved ${tasks.length} tasks to tasks.json`)
  } catch (e: any) {
    console.error('❌ Failed to write tasks.json:', e.message)
  }
}