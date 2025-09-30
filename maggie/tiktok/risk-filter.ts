const CTA_OPTIONS = [
  'Peek at this 👀',
  'Some of you need this 💌',
  'Stay magnetic with us ✨',
]

const CORE_HASHTAGS = ['soulblueprint', 'magnetkit', 'messyandmagnetic']

const RISKY_PHRASES: Array<{ pattern: RegExp; safe: string; severity: 'low' | 'high' }> = [
  { pattern: /suicide/gi, safe: 'feeling really low', severity: 'high' },
  { pattern: /kill(ed|ing)?/gi, safe: 'shut down', severity: 'high' },
  { pattern: /abuse/gi, safe: 'hurtful patterns', severity: 'high' },
  { pattern: /trauma/gi, safe: 'heavy memories', severity: 'low' },
  { pattern: /panic attack/gi, safe: 'spiraling moment', severity: 'low' },
]

const RISKY_HASHTAGS: Array<{ pattern: RegExp; safe: string }> = [
  { pattern: /#trauma(dump|tok)?/i, safe: '#healingjourney' },
  { pattern: /#anxietyattack/i, safe: '#calmspace' },
  { pattern: /#ptsd/i, safe: '#gentlegrowth' },
  { pattern: /#triggerwarning/i, safe: '#softlysaid' },
]

const REVIEW_TOPICS = new Set(['self-harm', 'suicide', 'violence', 'abuse'])

export interface SafetyInput {
  caption: string
  overlay: string
  hashtags: string[]
  topics?: string[]
}

export interface SafetyResult {
  caption: string
  overlay: string
  hashtags: string[]
  firstComment?: string
  flagged: boolean
  reasons: string[]
}

export function enforceCreativeSafety(input: SafetyInput): SafetyResult {
  let caption = ensureCta(input.caption)
  const hashtags = sanitizeHashtags([...input.hashtags, ...CORE_HASHTAGS])
  let overlay = input.overlay.trim()
  const reasons: string[] = []
  let flagged = false

  for (const { pattern, safe, severity } of RISKY_PHRASES) {
    if (pattern.test(caption) || pattern.test(overlay)) {
      caption = caption.replace(pattern, safe)
      overlay = overlay.replace(pattern, safe)
      reasons.push(`Replaced sensitive phrase with safe language (${safe}).`)
      if (severity === 'high') flagged = true
    }
  }

  for (const topic of input.topics ?? []) {
    if (REVIEW_TOPICS.has(topic.toLowerCase())) {
      flagged = true
      reasons.push(`Topic requires review: ${topic}`)
    }
  }

  const sanitizedHashtags = hashtags.map(tag => {
    for (const { pattern, safe } of RISKY_HASHTAGS) {
      if (pattern.test(tag)) {
        reasons.push(`Replaced risky hashtag ${tag} with ${safe}`)
        return safe
      }
    }
    return tag
  })

  const uniqueHashtags = Array.from(new Set(sanitizedHashtags.map(tag => tag.replace(/^#/, '').toLowerCase())))
  const normalizedHashtags = uniqueHashtags.map(tag => `#${tag}`)

  const firstComment = buildFirstComment(normalizedHashtags)

  return {
    caption,
    overlay,
    hashtags: normalizedHashtags,
    firstComment,
    flagged,
    reasons,
  }
}

function ensureCta(caption: string): string {
  const trimmed = caption.trim()
  const hasCta = CTA_OPTIONS.some(phrase => trimmed.toLowerCase().includes(phrase.toLowerCase()))
  if (hasCta) return trimmed
  return `${CTA_OPTIONS[0]}\n${trimmed}`
}

function sanitizeHashtags(hashtags: string[]): string[] {
  return hashtags
    .filter(Boolean)
    .map(tag => tag.replace(/^#/, ''))
    .map(tag => tag.replace(/[^a-z0-9]/gi, ''))
    .filter(Boolean)
}

function buildFirstComment(hashtags: string[]): string | undefined {
  const cta = CTA_OPTIONS[CTA_OPTIONS.length - 1]
  const selected = hashtags.slice(0, 3).join(' ')
  if (!selected) return undefined
  return `${cta}\n${selected}`
}
