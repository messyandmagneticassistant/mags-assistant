import fs from 'fs'
import path from 'path'

export interface BrainConfig {
  audience?: string
  styleNaturalNotAI?: boolean
  emotionRotation?: string[]
  personalAudience?: string[]
  [key: string]: any
}

export async function loadBrain(_key: string): Promise<BrainConfig> {
  const file = path.join(__dirname, 'memory.json')
  try {
    const raw = await fs.promises.readFile(file, 'utf8')
    const data = JSON.parse(raw)
    return {
      audience: data.audience || 'general',
      styleNaturalNotAI: data.styleNaturalNotAI ?? true,
      emotionRotation: data.emotionRotation || ['joy', 'grief', 'silly'],
      personalAudience: data.personalAudience || [],
      ...data
    }
  } catch {
    return { audience: 'general', styleNaturalNotAI: true, emotionRotation: ['joy', 'grief', 'silly'], personalAudience: [] }
  }
}
