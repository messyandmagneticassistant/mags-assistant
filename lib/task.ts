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

/**
 * Generates a default tasks.json file with predefined high-priority tasks
 */
export async function generateDefaultTasks(): Promise<void> {
  const tasksPath = path.resolve('./tasks.json')

  const defaultTasks: Task[] = [
    {
      name: 'Clean up Drive folders + delete junk',
      type: 'drive-cleanup',
      priority: 1
    },
    {
      name: 'Fix Notion workspace formatting + portal links',
      type: 'notion-cleanup',
      priority: 1
    },
    {
      name: 'Sync Stripe blueprint products + metadata',
      type: 'stripe-sync',
      priority: 2
    },
    {
      name: 'Generate soul-aligned icon bundles from quiz',
      type: 'icon-bundle-generator',
      priority: 2
    },
    {
      name: 'Finalize front-end: quiz, shop, Stripe, Notion',
      type: 'frontend-deploy',
      priority: 3
    },
    {
      name: 'Launch TikTok strategy: post 10–30/day via Maggie',
      type: 'social-run',
      priority: 4
    }
  ]

  try {
    await fs.writeFile(tasksPath, JSON.stringify(defaultTasks, null, 2), 'utf-8')
    console.log(`✅ Default tasks.json created at ${tasksPath}`)
  } catch (e: any) {
    console.error('❌ Failed to write default tasks.json:', e.message)
  }
}