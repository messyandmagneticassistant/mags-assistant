import { promises as fs } from 'fs'
import path from 'path'
import cron, { ScheduledTask } from 'node-cron'
import { execFile } from 'child_process'
import { promisify } from 'util'

import { runWithCodex } from '../../lib/codex'

type AIProvider = 'Codex' | 'Gemini' | 'ChatGPT'

export interface Task {
  prompt: string
  context?: string
  complexity?: string
  needs?: string
  type?: string
  user?: string
  metadata?: Record<string, any>
}

interface RouteLogEntry {
  timestamp: number
  ai: AIProvider
  task: Task
}

const execFileAsync = promisify(execFile)

const KV_FILE = path.resolve('brain', 'kv-store.json')
const THREAD_STATE_FALLBACK = path.resolve('config', 'thread-state.json')
const MEMORY_DIR = path.resolve('memory')
const MEMORY_FILE = path.join(MEMORY_DIR, 'brain.md')

let exportJob: ScheduledTask | null = null

async function ensureKvFile(): Promise<Record<string, any>> {
  try {
    const raw = await fs.readFile(KV_FILE, 'utf8')
    return JSON.parse(raw)
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      await fs.mkdir(path.dirname(KV_FILE), { recursive: true })
      await fs.writeFile(KV_FILE, JSON.stringify({}, null, 2), 'utf8')
      return {}
    }
    throw err
  }
}

async function readKv(): Promise<Record<string, any>> {
  try {
    const raw = await fs.readFile(KV_FILE, 'utf8')
    return JSON.parse(raw)
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      return await ensureKvFile()
    }
    throw err
  }
}

async function writeKv(store: Record<string, any>): Promise<void> {
  await fs.mkdir(path.dirname(KV_FILE), { recursive: true })
  await fs.writeFile(KV_FILE, JSON.stringify(store, null, 2), 'utf8')
}

export async function getKV<T>(key: string): Promise<T | null> {
  const store = await readKv()
  if (key in store) {
    return store[key] as T
  }

  if (key === 'thread-state') {
    try {
      const raw = await fs.readFile(THREAD_STATE_FALLBACK, 'utf8')
      return JSON.parse(raw) as T
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.warn('[llmBridge] Failed to load thread-state fallback:', err)
      }
    }
  }

  return null
}

export async function putKV<T>(key: string, value: T): Promise<void> {
  const store = await readKv()
  store[key] = value
  await writeKv(store)
}

export function routeToBestAI(task: Task): AIProvider {
  if (task.complexity === 'code' || task.needs === 'GitHub') return 'Codex'
  if (task.needs === 'research' || task.type === 'social') return 'Gemini'
  if (task.needs === 'spiritual' || task.user === 'Chanel') return 'ChatGPT'
  return 'ChatGPT'
}

export async function logRoute(data: { ai: AIProvider; task: Task }): Promise<void> {
  const existing = (await getKV<RouteLogEntry[]>('last-route')) || []
  const updated: RouteLogEntry[] = [
    ...existing,
    { timestamp: Date.now(), ai: data.ai, task: data.task },
  ]

  const LIMIT = 100
  const trimmed = updated.slice(-LIMIT)

  await putKV('last-route', trimmed)
}

export async function handleTask(task: Task): Promise<string> {
  const ai = routeToBestAI(task)
  await logRoute({ ai, task })
  return await callAI(ai, task)
}

export async function callGeminiOrGPT(prompt: string, overrides: Partial<Task> = {}): Promise<string> {
  const task: Task = {
    prompt,
    type: overrides.type || overrides.context,
    ...overrides,
  }
  return handleTask(task)
}

async function callAI(provider: AIProvider, task: Task): Promise<string> {
  switch (provider) {
    case 'Codex':
      return callCodex(task)
    case 'Gemini':
      return callGemini(task)
    case 'ChatGPT':
    default:
      return callChatGPT(task)
  }
}

async function callCodex(task: Task): Promise<string> {
  const contextPieces: string[] = []
  if (task.context) contextPieces.push(task.context)
  if (task.metadata) contextPieces.push(JSON.stringify(task.metadata))
  const context = contextPieces.filter(Boolean).join('\n') || 'General operations support.'

  return runWithCodex({
    task: task.prompt,
    context,
  })
}

async function callGemini(task: Task): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('Missing GEMINI_API_KEY for Gemini calls')

  const model = process.env.GEMINI_MODEL || 'gemini-1.5-pro'
  const baseUrl = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta/models'
  const url = `${baseUrl}/${model}:generateContent?key=${key}`

  const context = buildSystemContext(task)
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: context ? `${context}\n\n${task.prompt}` : task.prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const json = (await res.json().catch(() => ({}))) as Record<string, any>
  if (!res.ok) {
    throw new Error(`Gemini request failed (${res.status}): ${JSON.stringify(json)}`)
  }

  const text = extractGeminiText(json)
  if (!text) {
    throw new Error('Gemini returned an empty response')
  }

  return text
}

function extractGeminiText(payload: Record<string, any>): string | null {
  const candidates = payload?.candidates
  if (!Array.isArray(candidates) || !candidates.length) return null

  for (const candidate of candidates) {
    const parts = candidate?.content?.parts
    if (!Array.isArray(parts)) continue
    const chunks: string[] = []
    for (const part of parts) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        chunks.push(part.text.trim())
      } else if (typeof part?.functionCall?.arguments === 'string') {
        chunks.push(part.functionCall.arguments.trim())
      }
    }
    if (chunks.length) {
      const combined = chunks.join('\n').trim()
      if (combined.startsWith('```')) {
        return combined.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim()
      }
      return combined
    }
  }

  return null
}

async function callChatGPT(task: Task): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('Missing OPENAI_API_KEY for ChatGPT calls')

  const model = process.env.CHATGPT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const system = buildSystemContext(task) || 'You are Maggie, a helpful creative assistant.'

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: task.prompt },
  ]

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
    }),
  })

  const json = (await res.json().catch(() => ({}))) as Record<string, any>
  if (!res.ok) {
    throw new Error(`ChatGPT request failed (${res.status}): ${JSON.stringify(json)}`)
  }

  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('ChatGPT returned an empty response')
  }

  return content.trim()
}

function buildSystemContext(task: Task): string {
  const lines: string[] = []
  if (task.context) lines.push(task.context)
  if (task.needs) lines.push(`Primary need: ${task.needs}`)
  if (task.type) lines.push(`Task type: ${task.type}`)
  if (task.user) lines.push(`User: ${task.user}`)
  if (task.metadata && Object.keys(task.metadata).length) {
    lines.push(`Metadata: ${JSON.stringify(task.metadata)}`)
  }
  return lines.join('\n')
}

export async function exportMemoryToGitHub(): Promise<void> {
  const memory = await getKV<any>('thread-state')
  const markdown = `# 🧠 Maggie Thread State\n\n\`\`\`json\n${JSON.stringify(memory, null, 2)}\n\`\`\``

  await fs.mkdir(MEMORY_DIR, { recursive: true })
  await fs.writeFile(MEMORY_FILE, markdown, 'utf8')

  await gitCommitAndPush({
    message: '🧠 Nightly brain sync',
    files: ['memory/brain.md'],
  })
}

async function gitCommitAndPush(options: { message: string; files: string[] }): Promise<void> {
  const { message, files } = options

  const addArgs = ['add', ...files]
  await runGit(addArgs)

  const commitArgs = ['commit', '-m', message]
  try {
    await runGit(commitArgs)
  } catch (err: any) {
    const stderr = String(err?.stderr || err?.message || '')
    if (stderr.includes('nothing to commit') || stderr.includes('no changes added to commit')) {
      return
    }
    throw err
  }

  await runGit(['push'])
}

async function runGit(args: string[]): Promise<void> {
  try {
    await execFileAsync('git', args, { cwd: process.cwd() })
  } catch (err: any) {
    console.error('[llmBridge] git command failed', { args, error: err?.stderr || err?.message || err })
    throw err
  }
}

function scheduleExport(): void {
  if (exportJob) return
  exportJob = cron.schedule('30 3 * * *', async () => {
    try {
      await exportMemoryToGitHub()
    } catch (err) {
      console.error('[llmBridge] Nightly export failed:', err)
    }
  }, { timezone: 'UTC' })
}

scheduleExport()
