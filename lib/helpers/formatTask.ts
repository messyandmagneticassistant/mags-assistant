// lib/helpers/formatTask.ts

import { Task } from '../task.js'

/**
 * Returns a beautifully formatted task summary for CLI or logs.
 * Useful for debugging, inspection, or dev dashboards.
 */
export function formatTask(task: Task): string {
  const { name, type, priority = 0, context, metadata } = task

  const divider = '─'.repeat(40)
  const lines: string[] = []

  lines.push(`🗂️  Task: ${name}`)
  lines.push(`📦 Type: ${type}`)
  lines.push(`⭐ Priority: ${priority}`)
  if (context) lines.push(`📜 Context: ${context}`)

  if (metadata && Object.keys(metadata).length > 0) {
    lines.push('🧩 Metadata:')
    for (const [key, value] of Object.entries(metadata)) {
      lines.push(`   • ${key}: ${stringify(value)}`)
    }
  }

  return `${divider}\n${lines.join('\n')}\n${divider}`
}

/**
 * Helper to safely stringify metadata values.
 */
function stringify(value: any): string {
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return '[Unserializable]'
    }
  }

  return String(value)
}