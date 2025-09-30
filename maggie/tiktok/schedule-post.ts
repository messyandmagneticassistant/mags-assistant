import puppeteer, { Browser, Page } from 'puppeteer'
import path from 'path'
import { getEnv } from '../shared/env'

export interface TikTokSchedulePayload {
  videoPath: string
  caption: string
  hashtags: string[]
  overlayText: string
  scheduleTime: Date
  soundUrl?: string
  firstComment?: string
}

export interface TikTokScheduleResult {
  ok: boolean
  scheduledAt: Date
  details?: string
}

const MOUNTAIN_TZ = 'America/Denver'

export async function schedulePost(payload: TikTokSchedulePayload): Promise<TikTokScheduleResult> {
  const browser = await connectBrowser()
  let page: Page | null = null
  try {
    page = await browser.newPage()
    await page.goto('https://www.tiktok.com/upload?lang=en', { waitUntil: 'networkidle2' })

    await ensureLoggedIn(page)
    await uploadVideo(page, payload.videoPath)
    await attachTrendingSound(page, payload.soundUrl)
    await applyOverlayText(page, payload.overlayText)
    await fillCaption(page, payload.caption, payload.hashtags, payload.firstComment)
    await setSchedule(page, payload.scheduleTime)

    await submitSchedule(page)

    return { ok: true, scheduledAt: payload.scheduleTime }
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err)
    throw new Error(`TikTok schedule failed: ${details}`)
  } finally {
    if (page) {
      await page.close().catch(() => {})
    }
    await browser.close().catch(() => {})
  }
}

async function connectBrowser(): Promise<Browser> {
  const endpoint = getEnv('BROWSERLESS_URL')
  if (!endpoint) throw new Error('Missing BROWSERLESS_URL environment variable')
  return puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: { width: 1440, height: 900 } })
}

async function ensureLoggedIn(page: Page) {
  const uploadSelector = 'input[type="file"][accept="video/*"]'
  await page.waitForSelector(uploadSelector, { timeout: 45000 })
}

async function uploadVideo(page: Page, videoPath: string) {
  const uploadInput = await page.$('input[type="file"][accept="video/*"]')
  if (!uploadInput) throw new Error('Could not find TikTok upload input')
  await uploadInput.uploadFile(videoPath)
  const fileName = path.basename(videoPath)
  await page.waitForFunction(
    (name: string) => {
      const el = document.querySelector('[data-e2e="upload-video-name"]')
      return el ? el.textContent?.includes(name) : false
    },
    { timeout: 120000 },
    fileName
  )
}

async function attachTrendingSound(page: Page, soundUrl?: string) {
  if (!soundUrl) return
  try {
    await page.waitForSelector('[data-e2e="music-button"]', { timeout: 15000 })
    await page.click('[data-e2e="music-button"]')
    await page.waitForSelector('input[data-e2e="music-search-input"]', { timeout: 15000 })
    await page.type('input[data-e2e="music-search-input"]', soundUrl, { delay: 35 })
    await page.waitForTimeout(1200)
    const firstResult = await page.$('[data-e2e="music-result-item"]')
    if (firstResult) {
      await firstResult.click()
      await page.waitForTimeout(500)
      const confirm = await page.$('[data-e2e="music-use-button"]')
      if (confirm) await confirm.click()
    }
    const closeBtn = await page.$('[data-e2e="close-music-dialog"]')
    if (closeBtn) await closeBtn.click()
  } catch (err) {
    console.warn('[schedulePost] unable to attach sound', err)
  }
}

async function applyOverlayText(page: Page, overlayText: string) {
  if (!overlayText) return
  try {
    await page.waitForSelector('[data-e2e="open-overlay-editor"]', { timeout: 20000 })
    await page.click('[data-e2e="open-overlay-editor"]')
    await page.waitForSelector('[data-e2e="overlay-text-input"]', { timeout: 15000 })
    await page.focus('[data-e2e="overlay-text-input"]')
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyA')
    await page.keyboard.up('Control')
    await page.type('[data-e2e="overlay-text-input"]', overlayText, { delay: 30 })
    const safePreset = await page.$('[data-e2e="overlay-safe-style"]')
    if (safePreset) await safePreset.click()
    const confirm = await page.$('[data-e2e="overlay-apply"]')
    if (confirm) await confirm.click()
    await page.waitForTimeout(400)
  } catch (err) {
    console.warn('[schedulePost] unable to apply overlay', err)
  }
}

async function fillCaption(page: Page, caption: string, hashtags: string[], firstComment?: string) {
  const captionAreaSelector = '[data-e2e="caption-editor"] [contenteditable="true"]'
  await page.waitForSelector(captionAreaSelector, { timeout: 45000 })
  await page.click(captionAreaSelector)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  const finalCaption = buildCaption(caption, hashtags)
  await page.keyboard.type(finalCaption, { delay: 28 })

  if (firstComment) {
    try {
      const commentInput = await page.$('[data-e2e="first-comment-input"]')
      if (commentInput) {
        await commentInput.click({ clickCount: 3 })
        await page.type('[data-e2e="first-comment-input"]', firstComment, { delay: 25 })
      }
    } catch (err) {
      console.warn('[schedulePost] unable to set first comment', err)
    }
  }
}

async function setSchedule(page: Page, scheduleTime: Date) {
  const { dateStr, timeStr } = formatScheduleInputs(scheduleTime)
  await page.waitForSelector('[data-e2e="schedule-switch"]', { timeout: 20000 })
  const switchEl = await page.$('[data-e2e="schedule-switch"] input[type="checkbox"]')
  if (switchEl) {
    const isChecked = await page.evaluate((el: HTMLInputElement) => el.checked, switchEl)
    if (!isChecked) await switchEl.click()
  }
  await page.waitForSelector('input[data-e2e="schedule-date-input"]', { timeout: 15000 })
  await page.click('input[data-e2e="schedule-date-input"]', { clickCount: 3 })
  await page.type('input[data-e2e="schedule-date-input"]', dateStr)
  await page.click('input[data-e2e="schedule-time-input"]', { clickCount: 3 })
  await page.type('input[data-e2e="schedule-time-input"]', timeStr)
}

async function submitSchedule(page: Page) {
  await page.waitForSelector('[data-e2e="schedule-button"]', { timeout: 15000 })
  await page.click('[data-e2e="schedule-button"]')
  await page.waitForFunction(
    () => {
      return Boolean(document.querySelector('[data-e2e="schedule-success"], [data-e2e="schedule-toast-success"]'))
    },
    { timeout: 90000 }
  )
}

function buildCaption(caption: string, hashtags: string[]): string {
  const sanitizedTags = Array.from(new Set(hashtags.map(tag => (tag.startsWith('#') ? tag : `#${tag}`))))
  return [caption.trim(), '', sanitizedTags.join(' ')].filter(Boolean).join('\n')
}

function formatScheduleInputs(date: Date): { dateStr: string; timeStr: string } {
  const parts = getTimeZoneParts(date, MOUNTAIN_TZ)
  const dateStr = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
  const timeStr = `${pad(parts.hour)}:${pad(parts.minute)}`
  return { dateStr, timeStr }
}

function getTimeZoneParts(date: Date, timeZone: string) {
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
  const result: Record<string, number> = {}
  for (const part of parts) {
    if (part.type === 'literal') continue
    result[part.type] = Number(part.value)
  }
  return {
    year: result.year,
    month: result.month,
    day: result.day,
    hour: result.hour,
    minute: result.minute,
    second: result.second,
  }
}

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}
