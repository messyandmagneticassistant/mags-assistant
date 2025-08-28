// lib/runTaskQueue.ts

import { Task } from './task.js'
import { runWithCodex } from './codex.js'

/**
 * Executes a single task by sending it to Codex for interpretation.
 * Uses dynamic role, context, and optional metadata.
 */
export async function runTaskQueue(task: Task): Promise<void> {
  const prompt = buildPrompt(task)

  const result = await runWithCodex({
    agentName: 'Codex',
    role: task.type || 'task',
    context: task.context || `You are a helpful full-stack code assistant.`,
    task: prompt
  })

  console.log(`🧠 Codex output for "${task.name}":\n\n${result}\n`)
}

/**
 * Converts the Task object into a readable prompt string.
 * Includes optional metadata if available.
 */
function buildPrompt(task: Task): string {
  const meta = task.metadata
    ? `\n\nMetadata:\n${JSON.stringify(task.metadata, null, 2)}`
    : ''

  return `Your task is: ${task.name}${meta}`
}