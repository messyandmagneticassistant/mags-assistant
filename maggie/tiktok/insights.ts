import { getDb } from '../../lib/tiktok/db.js'

const MOUNTAIN_TZ = 'America/Denver'
const TemporalAny: typeof Temporal | undefined = (globalThis as any).Temporal

export interface PeakWindow {
  minutesSinceMidnight: number
  score: number
  sampleSize: number
}

export interface SoundTrend {
  sound: string
  score: number
  sampleSize: number
}

export interface SchedulingInsights {
  peakWindows: PeakWindow[]
  topSounds: SoundTrend[]
  averageScore: number
}

interface PerformanceRow {
  view_count: number
  likes: number
  comments: number
  shares: number
  sound: string | null
  timestamp: string | null
  last_updated: string
}

export function computeSchedulingInsights(windowDays = 7): SchedulingInsights {
  const db = getDb()
  const lowerBound = `-${Math.max(windowDays, 1)} days`
  const rows = db
    .prepare<[], PerformanceRow>(
      `SELECT p.view_count, p.likes, p.comments, p.shares, p.sound, v.timestamp, p.last_updated
       FROM performance p
       JOIN videos v ON v.id = p.video_id
       WHERE datetime(COALESCE(v.timestamp, p.last_updated)) >= datetime('now', ?)
         AND p.view_count > 0`
    )
    .all(lowerBound)

  const timeBuckets = new Map<number, { score: number; sampleSize: number }>()
  const soundBuckets = new Map<string, { score: number; sampleSize: number }>()
  let aggregateScore = 0

  for (const row of rows) {
    const score = engagementScore(row)
    aggregateScore += score
    const when = row.timestamp ?? row.last_updated
    const bucket = bucketForTimestamp(when)
    if (bucket !== null) {
      const current = timeBuckets.get(bucket) ?? { score: 0, sampleSize: 0 }
      current.score += score
      current.sampleSize += 1
      timeBuckets.set(bucket, current)
    }
    if (row.sound) {
      const current = soundBuckets.get(row.sound) ?? { score: 0, sampleSize: 0 }
      current.score += score
      current.sampleSize += 1
      soundBuckets.set(row.sound, current)
    }
  }

  const peakWindows: PeakWindow[] = Array.from(timeBuckets.entries())
    .map(([minutesSinceMidnight, data]) => ({
      minutesSinceMidnight,
      score: data.score / Math.max(data.sampleSize, 1),
      sampleSize: data.sampleSize,
    }))
    .sort((a, b) => b.score - a.score || b.sampleSize - a.sampleSize)

  const topSounds: SoundTrend[] = Array.from(soundBuckets.entries())
    .map(([sound, data]) => ({
      sound,
      score: data.score / Math.max(data.sampleSize, 1),
      sampleSize: data.sampleSize,
    }))
    .sort((a, b) => b.score - a.score || b.sampleSize - a.sampleSize)

  const averageScore = rows.length ? aggregateScore / rows.length : 0

  return { peakWindows, topSounds, averageScore }
}

export function bucketForTimestamp(timestamp: string | null): number | null {
  if (!timestamp) return null
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  const parts = getTimeZoneParts(date, MOUNTAIN_TZ)
  const minutesSinceMidnight = parts.hour * 60 + Math.floor(parts.minute / 5) * 5
  return minutesSinceMidnight
}

function engagementScore(row: PerformanceRow): number {
  return row.view_count + row.likes * 4 + row.comments * 3 + row.shares * 5
}

export function nextOccurrenceFromBucket(
  minutesSinceMidnight: number,
  now: Date,
  offsetDays = 0
): Date {
  const baseParts = getTimeZoneParts(now, MOUNTAIN_TZ)
  const targetHour = Math.floor(minutesSinceMidnight / 60)
  const targetMinute = minutesSinceMidnight % 60
  const target = createDateInTimeZone(
    {
      year: baseParts.year,
      month: baseParts.month,
      day: baseParts.day,
      hour: targetHour,
      minute: targetMinute,
      second: 0,
    },
    MOUNTAIN_TZ
  )
  if (target.getTime() <= now.getTime()) {
    return createDateInTimeZone(
      {
        year: baseParts.year,
        month: baseParts.month,
        day: baseParts.day + 1 + offsetDays,
        hour: targetHour,
        minute: targetMinute,
        second: 0,
      },
      MOUNTAIN_TZ
    )
  }
  if (offsetDays > 0) {
    return createDateInTimeZone(
      {
        year: baseParts.year,
        month: baseParts.month,
        day: baseParts.day + offsetDays,
        hour: targetHour,
        minute: targetMinute,
        second: 0,
      },
      MOUNTAIN_TZ
    )
  }
  return target
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function getTimeZoneParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(date)
  const out: Record<string, number> = {}
  for (const part of parts) {
    if (part.type === 'literal') continue
    out[part.type] = Number(part.value)
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second,
  }
}

function createDateInTimeZone(parts: ZonedParts, timeZone: string): Date {
  if (TemporalAny?.ZonedDateTime) {
    const zdt = TemporalAny.ZonedDateTime.from({
      timeZone,
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
      millisecond: 0,
    })
    return new Date(Number(zdt.epochMilliseconds))
  }

  const pad = (value: number) => value.toString().padStart(2, '0')
  const localIso = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
  const asDate = new Date(localIso + 'Z')
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const offsetDate = new Date(formatter.format(asDate))
  const diff = asDate.getTime() - offsetDate.getTime()
  return new Date(asDate.getTime() - diff)
}
