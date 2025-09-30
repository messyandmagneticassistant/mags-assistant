import fs from 'fs/promises'
import path from 'path'

import { generateCaptionAndOverlay } from '../core/generateCaption'
import { log } from '../../shared/logger'
import { fetchTrendingAudios } from './trend-sync'
import { enforceCreativeSafety } from './risk-filter'
import { computeSchedulingInsights, nextOccurrenceFromBucket, SchedulingInsights } from './insights'
import { schedulePost, TikTokSchedulePayload } from './schedule-post'

interface QueueItem {
  id: string
  videoPath: string
  title: string
  emotion?: string
  topics?: string[]
  attempts?: number
  scheduledFor?: string
}

interface QueueFile {
  items: QueueItem[]
  failures: FailureRecord[]
  review?: ReviewRecord[]
  flaggedIds?: string[]
}

interface FailureRecord {
  id: string
  reason: string
  attempts: number
  lastTriedAt: string
}

interface ReviewRecord {
  id: string
  reason: string
  createdAt: string
  metadata?: Record<string, unknown>
}

interface GrowthConfig {
  handle: string
  timezone?: string
}

const QUEUE_FILE = path.join(process.cwd(), 'queue.json')

export async function runGrowthEngine(config: GrowthConfig) {
  const queue = await readQueue()
  const insights = computeSchedulingInsights(7)
  const trendingSounds = await safeFetchTrendingSounds()
  const flagged = new Set(queue.flaggedIds ?? [])

  const pending = queue.items.filter(item => !flagged.has(item.id))
  const reviewList = queue.review ?? []
  const failures = queue.failures ?? []
  const timezone = config.timezone ?? 'America/Denver'

  log(`[growth-engine] starting run for @${config.handle} with ${pending.length} queued clip(s)`) 

  for (const item of pending) {
    try {
      const creative = await generateCaptionAndOverlay({ title: item.title })
      const safety = enforceCreativeSafety({
        caption: creative.caption,
        overlay: creative.overlay,
        hashtags: creative.hashtags,
        topics: item.topics,
      })

      if (safety.flagged) {
        reviewList.push({
          id: item.id,
          reason: safety.reasons.join(' '),
          createdAt: new Date().toISOString(),
          metadata: { title: item.title },
        })
        flagged.add(item.id)
        log(`[growth-engine] flagged ${item.id} for manual review`)
        continue
      }

      const scheduleOptions = buildScheduleCandidates(insights, new Date())
      if (!scheduleOptions.length) {
        throw new Error('No viable schedule windows available')
      }

      let scheduled = false
      let attempts = item.attempts ?? 0
      const payloadBase: Omit<TikTokSchedulePayload, 'scheduleTime'> = {
        videoPath: item.videoPath,
        caption: safety.caption,
        hashtags: safety.hashtags,
        overlayText: safety.overlay,
        soundUrl: pickSound(trendingSounds, insights.topSounds),
        firstComment: safety.firstComment,
      }

      for (const candidate of scheduleOptions) {
        if (scheduled) break
        if (attempts > 2) break
        const scheduleTime = candidate
        const payload: TikTokSchedulePayload = { ...payloadBase, scheduleTime }
        try {
          log(`[growth-engine] scheduling ${item.id} at ${scheduleTime.toISOString()} (${timezone})`)
          await schedulePost(payload)
          scheduled = true
          item.scheduledFor = scheduleTime.toISOString()
          log(`[growth-engine] scheduled ${item.id} successfully for ${scheduleTime.toISOString()}`)
        } catch (err) {
          attempts += 1
          const detail = err instanceof Error ? err.message : String(err)
          log(`[growth-engine] schedule attempt failed for ${item.id}: ${detail}`)
        }
      }

      if (!scheduled) {
        failures.push({
          id: item.id,
          reason: 'All schedule attempts failed',
          attempts: attempts + 1,
          lastTriedAt: new Date().toISOString(),
        })
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      failures.push({
        id: item.id,
        reason: detail,
        attempts: (item.attempts ?? 0) + 1,
        lastTriedAt: new Date().toISOString(),
      })
    } finally {
      queue.items = queue.items.filter(q => q.id !== item.id)
    }
  }

  queue.failures = dedupeFailures(failures)
  queue.review = reviewList
  queue.flaggedIds = Array.from(flagged)
  await writeQueue(queue)
}

async function readQueue(): Promise<QueueFile> {
  try {
    const raw = await fs.readFile(QUEUE_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as QueueFile
    return {
      items: parsed.items ?? [],
      failures: parsed.failures ?? [],
      review: parsed.review ?? [],
      flaggedIds: parsed.flaggedIds ?? [],
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { items: [], failures: [], review: [], flaggedIds: [] }
    }
    throw err
  }
}

async function writeQueue(queue: QueueFile) {
  await fs.writeFile(QUEUE_FILE, JSON.stringify(queue, null, 2))
}

function dedupeFailures(failures: FailureRecord[]): FailureRecord[] {
  const map = new Map<string, FailureRecord>()
  for (const failure of failures) {
    const existing = map.get(failure.id)
    if (!existing || existing.attempts < failure.attempts) {
      map.set(failure.id, failure)
    }
  }
  return Array.from(map.values())
}

function buildScheduleCandidates(insights: SchedulingInsights, now: Date): Date[] {
  const candidates: Date[] = []
  const topWindows = insights.peakWindows.slice(0, 6)
  for (let i = 0; i < topWindows.length; i += 1) {
    const window = topWindows[i]
    const baseDate = nextOccurrenceFromBucket(window.minutesSinceMidnight, now, Math.floor(i / 3))
    if (baseDate.getTime() > now.getTime() + 8 * 60 * 1000) {
      candidates.push(baseDate)
    }
  }
  if (!candidates.length) {
    candidates.push(new Date(now.getTime() + 15 * 60 * 1000))
  }
  return candidates
}

function pickSound(trending: string[], insightSounds: { sound: string }[]): string | undefined {
  if (!trending.length) return undefined
  const normalizedTrending = trending.map(url => ({ url, slug: normalizeSound(url) }))
  for (const insight of insightSounds) {
    const slug = normalizeSound(insight.sound)
    const match = normalizedTrending.find(item => item.slug && slug && item.slug.includes(slug))
    if (match) return match.url
  }
  return trending[0]
}

function normalizeSound(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

async function safeFetchTrendingSounds(): Promise<string[]> {
  try {
    return await fetchTrendingAudios()
  } catch (err) {
    log(`[growth-engine] failed to fetch trending sounds: ${err instanceof Error ? err.message : err}`)
    return []
  }
}
