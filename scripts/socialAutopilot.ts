import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import type { drive_v3 } from 'googleapis';

import { getDrive } from '../lib/google';
import { getConfigValue, putConfig } from '../lib/kv';
import { analyzeTrends } from '../insights';
import { buildSchedule } from '../lib/social/tiktokScheduler';
import { sendTelegramMessage } from './lib/telegramClient';

// Puppeteer is optional at compile-time; we resolve at runtime to avoid bundling issues.
type Browser = any;
type Page = any;

type QueueStatus = 'queued' | 'posted' | 'retry';

interface PostAnalytics {
  id: string;
  views: number;
  likes: number;
  comments: number;
  caption?: string;
  sound?: string;
  url?: string;
  postedAt: string;
}

interface QueueItem {
  id: string;
  driveId: string;
  driveName: string;
  status: QueueStatus;
  scheduledTime: string;
  attempts: number;
  postedAt?: string;
  trackingTag: string;
  caption?: string;
  sound?: string;
  analytics?: PostAnalytics;
  lastError?: string;
  history: string[];
}

interface QueueState {
  version: number;
  items: QueueItem[];
  lastDriveSync?: string;
  lastAnalyticsSync?: string;
  lastRunAt?: string;
  notes?: string[];
}

interface AnalyticsSnapshot {
  bestTimes: string[];
  trendingHooks: string[];
  trendingSounds: string[];
  posts: PostAnalytics[];
  averageViews?: number;
  fetchedAt: string;
  source: 'api' | 'scrape' | 'fallback';
}

interface TikTokSession {
  name: string;
  type: 'main' | 'booster';
  value: string;
}

interface PostOutcome {
  item: QueueItem;
  success: boolean;
  message: string;
}

const QUEUE_KEY = 'PostQ:social-queue';
const WORK_ROOT = path.join(process.cwd(), 'work');
const LOCAL_QUEUE_PATH = path.join(WORK_ROOT, 'social-autopilot-queue.json');
const RAW_DRIVE_FALLBACK = '/raw';
const HANDLE = '@messyandmagnetic';
const HOURS_24 = 24 * 60 * 60 * 1000;
const DEFAULT_BEST_TIMES = ['09:00', '12:30', '19:15'];
const FLOP_VIEW_THRESHOLD = Number(process.env.TIKTOK_FLOP_VIEWS_THRESHOLD ?? 2500);
const MAX_RETRIES = Number(process.env.TIKTOK_MAX_RETRIES ?? 3);
const TELEGRAM_PREFIX = '📣 Social Autopilot';

function nowIso(): string {
  return new Date().toISOString();
}
function isQueueItem(value: unknown): value is QueueItem {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Partial<QueueItem>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.driveId === 'string' &&
    typeof obj.status === 'string' &&
    typeof obj.scheduledTime === 'string'
  );
}

function normalizeQueueState(value: unknown): QueueState {
  if (value && typeof value === 'object') {
    const obj = value as Partial<QueueState>;
    if (Array.isArray(obj.items)) {
      const items = obj.items.filter(isQueueItem).map((item) => ({
        ...item,
        history: Array.isArray(item.history) ? item.history : [],
      }));
      return {
        version: typeof obj.version === 'number' ? obj.version : 1,
        items,
        lastDriveSync: typeof obj.lastDriveSync === 'string' ? obj.lastDriveSync : undefined,
        lastAnalyticsSync:
          typeof obj.lastAnalyticsSync === 'string' ? obj.lastAnalyticsSync : undefined,
        lastRunAt: typeof obj.lastRunAt === 'string' ? obj.lastRunAt : undefined,
        notes: Array.isArray(obj.notes)
          ? obj.notes.filter((note): note is string => typeof note === 'string')
          : [],
      };
    }
  }
  return {
    version: 1,
    items: [],
    notes: [],
  };
}

async function readLocalQueue(): Promise<QueueState | null> {
  try {
    const raw = await fs.readFile(LOCAL_QUEUE_PATH, 'utf8');
    return normalizeQueueState(JSON.parse(raw));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && code !== 'ENOENT') {
      console.warn('[social-autopilot] Unable to read local queue:', err);
    }
    return null;
  }
}

async function loadQueueState(): Promise<QueueState> {
  try {
    const remote = await getConfigValue<QueueState>(QUEUE_KEY, { type: 'json' });
    if (remote) {
      return normalizeQueueState(remote);
    }
  } catch (err) {
    console.warn('[social-autopilot] Failed to fetch queue from KV:', err);
  }
  const local = await readLocalQueue();
  if (local) {
    return local;
  }
  return {
    version: 1,
    items: [],
    notes: [],
  };
}

async function persistQueueState(queue: QueueState): Promise<void> {
  queue.lastRunAt = nowIso();
  try {
    await putConfig(QUEUE_KEY, queue);
    console.log('[social-autopilot] Queue persisted to Cloudflare KV');
  } catch (err) {
    console.warn('[social-autopilot] Failed to write queue to KV:', err);
  }

  try {
    await fs.mkdir(path.dirname(LOCAL_QUEUE_PATH), { recursive: true });
    await fs.writeFile(LOCAL_QUEUE_PATH, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.warn('[social-autopilot] Failed to store local queue backup:', err);
  }
}
function normalizeTimeWindow(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/(\d{1,2})(:(\d{2}))?/);
  if (!match) return null;
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = match[3] ? Math.min(59, Number(match[3])) : 0;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function buildTrackingTag(source: string): string {
  const suffix = crypto.createHash('md5').update(source).digest('hex').slice(0, 6);
  return `#mags${suffix}`;
}

function resolveRawFolderId(): string | null {
  const envId =
    process.env.SOCIAL_AUTOPILOT_RAW_FOLDER_ID ||
    process.env.TIKTOK_RAW_DRIVE_FOLDER_ID ||
    process.env.RAW_DRIVE_FOLDER_ID ||
    process.env.RAW_DRIVE_FOLDER ||
    '';
  if (envId.trim()) return envId.trim();
  return RAW_DRIVE_FALLBACK;
}

function getSessions(): TikTokSession[] {
  const entries = Object.entries(process.env)
    .filter(([key, value]) => key.startsWith('TIKTOK_SESSION_') && typeof value === 'string' && value)
    .map(([key, value]) => {
      const upper = key.toUpperCase();
      const type: 'main' | 'booster' = upper.includes('MAIN') ? 'main' : 'booster';
      return {
        name: key.replace('TIKTOK_SESSION_', ''),
        type,
        value: value as string,
      } satisfies TikTokSession;
    });
  entries.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'main' ? -1 : 1;
  });
  return entries;
}

async function getPuppeteerModule(): Promise<any | null> {
  try {
    return await import('puppeteer-core');
  } catch {
    try {
      return await import('puppeteer');
    } catch (err) {
      console.warn('[social-autopilot] Puppeteer not available:', err);
      return null;
    }
  }
}

function buildBrowserlessEndpoint(): string | null {
  const explicit = process.env.BROWSERLESS_WS_ENDPOINT || process.env.BROWSERLESS_ENDPOINT;
  if (explicit) return explicit;
  const base =
    process.env.BROWSERLESS_BASE_URL ||
    process.env.BROWSERLESS_URL ||
    process.env.BROWSERLESS_HOST ||
    'wss://chrome.browserless.io';
  const token =
    process.env.BROWSERLESS_API_KEY ||
    process.env.BROWSERLESS_TOKEN ||
    process.env.BROWSERLESS_KEY ||
    process.env.BROWSERLESS_SECRET ||
    '';
  let endpoint = base.replace(/^http/, 'ws');
  if (token && !endpoint.includes('token=')) {
    endpoint += (endpoint.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
  }
  return endpoint;
}

function parseCookieValue(raw: string): { name: string; value: string; domain: string; path: string }[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map((cookie) => {
          if (!cookie || typeof cookie !== 'object') return null;
          const name = typeof cookie.name === 'string' ? cookie.name : undefined;
          const value = typeof cookie.value === 'string' ? cookie.value : undefined;
          if (!name || !value) return null;
          return {
            name,
            value,
            domain: typeof cookie.domain === 'string' ? cookie.domain : '.tiktok.com',
            path: typeof cookie.path === 'string' ? cookie.path : '/',
          };
        })
        .filter((cookie): cookie is { name: string; value: string; domain: string; path: string } => Boolean(cookie));
    }
  } catch {
    // Not JSON formatted
  }

  const segments = trimmed.split(';').map((segment) => segment.trim());
  const first = segments[0];
  if (!first || !first.includes('=')) {
    return [
      {
        name: 'sessionid',
        value: trimmed,
        domain: '.tiktok.com',
        path: '/',
      },
    ];
  }
  const [name, ...rest] = first.split('=');
  return [
    {
      name: name.trim(),
      value: rest.join('=').trim(),
      domain: '.tiktok.com',
      path: '/',
    },
  ];
}

async function applySession(page: Page, session: TikTokSession): Promise<void> {
  const cookies = parseCookieValue(session.value);
  if (!cookies.length) return;
  await page.setCookie(
    ...cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      httpOnly: false,
      secure: true,
    })),
  );
}

async function openBrowserless(session: TikTokSession | undefined): Promise<{ browser: Browser; page: Page }> {
  const endpoint = buildBrowserlessEndpoint();
  if (!endpoint) {
    throw new Error('Missing Browserless endpoint configuration');
  }
  const puppeteer = await getPuppeteerModule();
  if (!puppeteer) {
    throw new Error('Puppeteer is not installed');
  }
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  if (session) {
    await page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded' });
    await applySession(page, session);
  }
  return { browser, page };
}
function computeNextSchedule(
  bestTimes: string[],
  queue: QueueState,
  now = new Date(),
  offsetMinutes = 0,
): Date {
  const windows = bestTimes.length ? bestTimes : DEFAULT_BEST_TIMES;
  const upcoming: Date[] = [];
  const baseTime = new Date(now.getTime() + offsetMinutes * 60 * 1000);
  for (let day = 0; day < 5; day += 1) {
    for (const window of windows) {
      const normalized = normalizeTimeWindow(window);
      if (!normalized) continue;
      const [hour, minute] = normalized.split(':').map(Number);
      const candidate = new Date(baseTime);
      candidate.setHours(hour, minute, 0, 0);
      candidate.setDate(baseTime.getDate() + day);
      if (candidate.getTime() <= baseTime.getTime()) {
        candidate.setDate(candidate.getDate() + 1);
      }
      upcoming.push(candidate);
    }
  }
  upcoming.sort((a, b) => a.getTime() - b.getTime());

  const scheduledTimes = new Set(
    queue.items
      .filter((item) => item.status !== 'posted')
      .map((item) => new Date(item.scheduledTime).getTime()),
  );

  for (const candidate of upcoming) {
    let conflict = false;
    for (const scheduled of scheduledTimes) {
      if (Math.abs(scheduled - candidate.getTime()) < 5 * 60 * 1000) {
        conflict = true;
        break;
      }
    }
    if (!conflict) {
      return candidate;
    }
  }

  return new Date(baseTime.getTime() + 2 * 60 * 60 * 1000);
}

async function fetchDriveVideos(queue: QueueState): Promise<drive_v3.Schema$File[]> {
  const folderId = resolveRawFolderId();
  if (!folderId || folderId === RAW_DRIVE_FALLBACK) {
    console.warn('[social-autopilot] RAW folder ID missing; skipping Drive sync');
    return [];
  }

  const drive = await getDrive();
  const query = `('${folderId}' in parents) and (mimeType contains 'video/') and trashed = false`;
  const res = await drive.files.list({
    q: query,
    orderBy: 'createdTime desc',
    fields: 'files(id, name, createdTime, modifiedTime, mimeType, size)',
    pageSize: 20,
  });
  const files = res.data.files ?? [];
  queue.lastDriveSync = nowIso();
  const knownIds = new Set(queue.items.map((item) => item.driveId));
  return files.filter((file) => file.id && !knownIds.has(file.id));
}

async function enqueueNewVideos(
  queue: QueueState,
  files: drive_v3.Schema$File[],
  analytics: AnalyticsSnapshot,
): Promise<QueueItem[]> {
  const results: QueueItem[] = [];
  if (!files.length) return results;

  for (const file of files) {
    if (!file.id) continue;
    const existing = queue.items.find((item) => item.driveId === file.id);
    if (existing) continue;

    const trackingTag = buildTrackingTag(file.id);
    const scheduled = computeNextSchedule(analytics.bestTimes, queue);
    const caption = generateCaption(file, analytics, trackingTag);
    const queueItem: QueueItem = {
      id: file.id,
      driveId: file.id,
      driveName: file.name ?? 'unnamed',
      status: 'queued',
      scheduledTime: scheduled.toISOString(),
      attempts: 0,
      trackingTag,
      caption,
      sound: analytics.trendingSounds[0],
      history: [`queued:${nowIso()}`],
    };

    queue.items.push(queueItem);
    results.push(queueItem);
  }

  if (results.length) {
    console.log(`[social-autopilot] Enqueued ${results.length} new video(s) from Drive`);
  }

  return results;
}

function generateCaption(
  file: drive_v3.Schema$File,
  analytics: AnalyticsSnapshot,
  trackingTag: string,
): string {
  const hooks = analytics.trendingHooks.length ? analytics.trendingHooks : ['POV: magnetic glow up'];
  const sounds = analytics.trendingSounds.length ? analytics.trendingSounds : ['#fyp'];
  const baseName = file.name?.replace(/\.[^.]+$/, '') ?? 'New drop';
  const hook = hooks[0];
  const sound = sounds[0];
  const hashtags = ['#messyandmagnetic', '#magneticmindset', trackingTag];
  return `${hook} — ${baseName}\n${hashtags.join(' ')}\n${sound}`;
}

async function downloadDriveFile(fileId: string, fileName: string): Promise<string> {
  const drive = await getDrive();
  await fs.mkdir(WORK_ROOT, { recursive: true });
  const safeName = fileName.replace(/[^a-z0-9_.-]+/gi, '_');
  const targetPath = path.join(WORK_ROOT, `${fileId}-${safeName}`);
  const dest = createWriteStream(targetPath);
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  await new Promise<void>((resolve, reject) => {
    res.data
      .on('error', reject)
      .pipe(dest)
      .on('error', reject)
      .on('finish', () => resolve());
  });
  return targetPath;
}

async function runBoosters(sessions: TikTokSession[], item: QueueItem): Promise<void> {
  const url = item.analytics?.url || `https://www.tiktok.com/${HANDLE.replace('@', '')}`;
  for (const session of sessions) {
    try {
      const { browser, page } = await openBrowserless(session);
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
        await page.waitForTimeout(5000);
        const likeButton = await page.$('[data-e2e="like-icon"]');
        if (likeButton) {
          await likeButton.click().catch(() => undefined);
        }
        const commentField = await page.$('[data-e2e="comment-input"]');
        if (commentField) {
          await commentField.click();
          await commentField.type('✨ Boosting the signal ✨');
          const send = await page.$('[data-e2e="comment-post"]');
          await send?.click();
        }
      } finally {
        await browser.close();
      }
    } catch (err) {
      console.warn(`[social-autopilot] Booster ${session.name} failed`, err);
    }
  }
}

async function postToTikTok(
  item: QueueItem,
  session: TikTokSession,
  analytics: AnalyticsSnapshot,
  boosters: TikTokSession[],
): Promise<PostOutcome> {
  const start = Date.now();
  let videoPath: string | undefined;
  let browser: Browser | undefined;

  try {
    videoPath = await downloadDriveFile(item.driveId, item.driveName);
  } catch (err) {
    throw new Error(`Drive download failed: ${(err as Error).message}`);
  }

  try {
    const { browser: browserInstance, page } = await openBrowserless(session);
    browser = browserInstance;
    await page.goto('https://www.tiktok.com/upload?lang=en', { waitUntil: 'networkidle2', timeout: 120000 });

    const input = await page.waitForSelector('input[type="file"]', { timeout: 60000 });
    if (!input) throw new Error('Upload input not found');
    await input.uploadFile(videoPath);

    const captionSelector = 'textarea[placeholder*="Caption"],div[contenteditable="true"]';
    const captionElement = await page.waitForSelector(captionSelector, { timeout: 60000 });
    if (captionElement) {
      await captionElement.click({ clickCount: 3 }).catch(() => undefined);
      await captionElement.type(
        item.caption ?? generateCaption({ name: item.driveName } as drive_v3.Schema$File, analytics, item.trackingTag),
      );
    }

    const scheduleToggle = await page.$('[data-e2e="schedule-toggle"]');
    if (scheduleToggle) {
      await scheduleToggle.evaluate((el) => {
        if (el instanceof HTMLElement && el.getAttribute('aria-checked') === 'true') {
          // leave scheduled posts disabled; autopilot posts immediately
          return;
        }
        if (el instanceof HTMLElement) {
          el.click();
        }
      });
    }

    const postButton = await page.waitForSelector('[data-e2e="post-button"],button:has-text("Post")', {
      timeout: 120000,
    });
    if (!postButton) throw new Error('Post button unavailable');

    await postButton.click();
    await page.waitForTimeout(5000);

    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-e2e="upload-success"], [data-e2e="publish-success"]');
        return Boolean(el);
      },
      { timeout: 180000 },
    );

    const postedUrl = await page.evaluate(() => {
      const anchor = document.querySelector('a[href*="/video/"]');
      return anchor instanceof HTMLAnchorElement ? anchor.href : null;
    });

    item.status = 'posted';
    item.postedAt = nowIso();
    item.history.push(`posted:${item.postedAt}`);
    item.analytics = {
      id: postedUrl ?? `${item.id}:${Date.now()}`,
      views: 0,
      likes: 0,
      comments: 0,
      caption: item.caption,
      sound: item.sound,
      url: postedUrl ?? undefined,
      postedAt: item.postedAt,
    };

    if (boosters.length) {
      await runBoosters(boosters, item);
    }

    const duration = Math.round((Date.now() - start) / 1000);
    return {
      item,
      success: true,
      message: `Posted ${item.driveName} in ${duration}s`,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`TikTok post failed: ${errorMessage}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (err) {
        console.warn('[social-autopilot] Failed to close browser session:', err);
      }
    }
    if (videoPath) {
      try {
        await fs.unlink(videoPath);
      } catch (err) {
        console.warn('[social-autopilot] Unable to remove temp file:', err);
      }
    }
  }
}
async function pullAnalyticsFromApi(): Promise<AnalyticsSnapshot | null> {
  const endpoint = process.env.TIKTOK_ANALYTICS_URL;
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    url.searchParams.set('handle', HANDLE);
    const headers: Record<string, string> = {};
    if (process.env.TIKTOK_ANALYTICS_TOKEN) {
      headers.Authorization = `Bearer ${process.env.TIKTOK_ANALYTICS_TOKEN}`;
    }
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${text}`);
    }
    const payload = await res.json();
    const bestTimes = Array.isArray(payload.bestTimes)
      ? payload.bestTimes
          .map((value: unknown) => (typeof value === 'string' ? normalizeTimeWindow(value) : null))
          .filter((value): value is string => Boolean(value))
      : [];
    const trendingHooks = Array.isArray(payload.trendingHooks)
      ? payload.trendingHooks.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    const trendingSounds = Array.isArray(payload.trendingSounds)
      ? payload.trendingSounds.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    const posts = Array.isArray(payload.posts)
      ? payload.posts
          .map((entry: any): PostAnalytics | null => {
            if (!entry) return null;
            const caption = typeof entry.caption === 'string' ? entry.caption : undefined;
            const tagId =
              typeof entry.id === 'string'
                ? entry.id
                : typeof entry.videoId === 'string'
                ? entry.videoId
                : crypto.randomUUID();
            const postedAt =
              typeof entry.postedAt === 'string'
                ? entry.postedAt
                : typeof entry.publishTime === 'string'
                ? entry.publishTime
                : nowIso();
            return {
              id: tagId,
              views: Number(entry.views ?? entry.playCount ?? 0),
              likes: Number(entry.likes ?? entry.diggCount ?? 0),
              comments: Number(entry.comments ?? entry.commentCount ?? 0),
              caption,
              sound:
                typeof entry.sound === 'string'
                  ? entry.sound
                  : typeof entry.musicTitle === 'string'
                  ? entry.musicTitle
                  : undefined,
              url:
                typeof entry.url === 'string'
                  ? entry.url
                  : typeof entry.shareUrl === 'string'
                  ? entry.shareUrl
                  : undefined,
              postedAt,
            };
          })
          .filter((entry): entry is PostAnalytics => entry !== null)
      : [];

    return {
      bestTimes: bestTimes.length ? bestTimes : DEFAULT_BEST_TIMES,
      trendingHooks,
      trendingSounds,
      posts,
      fetchedAt: nowIso(),
      averageViews:
        posts.length > 0 ? posts.reduce((acc, cur) => acc + cur.views, 0) / posts.length : undefined,
      source: 'api',
    };
  } catch (err) {
    console.warn('[social-autopilot] Analytics API failed:', err);
    return null;
  }
}

async function scrapeAnalytics(session: TikTokSession | undefined): Promise<AnalyticsSnapshot | null> {
  if (!session) return null;
  try {
    const { browser, page } = await openBrowserless(session);
    try {
      await page.goto('https://www.tiktok.com/analytics?lang=en', { waitUntil: 'networkidle2', timeout: 120000 });
      await page.waitForTimeout(8000);
      const payload = await page.evaluate(() => {
        const bestTimeNodes = Array.from(
          document.querySelectorAll('[data-e2e="best-time-slot"], [data-e2e="best-time-item"]'),
        );
        const bestTimes = bestTimeNodes
          .map((node) => (node instanceof HTMLElement ? node.innerText : ''))
          .map((text) => text.replace(/[^0-9:]/g, ''))
          .filter((text) => text);

        const trendingNodes = Array.from(
          document.querySelectorAll('[data-e2e="trending-hashtag"], [data-e2e="trending-hook"]'),
        );
        const hooks = trendingNodes
          .map((node) => (node instanceof HTMLElement ? node.innerText : ''))
          .map((text) => text.trim())
          .filter((text) => text);

        const soundNodes = Array.from(
          document.querySelectorAll('[data-e2e="popular-sound"], [data-e2e="music-item"]'),
        );
        const sounds = soundNodes
          .map((node) => (node instanceof HTMLElement ? node.innerText : ''))
          .map((text) => text.trim())
          .filter((text) => text);

        const postNodes = Array.from(document.querySelectorAll('[data-e2e="analytics-post-item"]'));
        const posts = postNodes
          .map((node) => {
            if (!(node instanceof HTMLElement)) return null;
            const caption = node.querySelector('[data-e2e="post-caption"]')?.textContent ?? undefined;
            const stats = node.querySelectorAll('[data-e2e="post-stat"]');
            const [views, likes, comments] = Array.from(stats).map((el) =>
              Number((el as HTMLElement).innerText.replace(/[^0-9]/g, '')),
            );
            const link = node.querySelector('a[href*="/video/"]');
            return {
              caption,
              views: views ?? 0,
              likes: likes ?? 0,
              comments: comments ?? 0,
              url: link instanceof HTMLAnchorElement ? link.href : undefined,
            };
          })
          .filter((entry) => entry !== null);

        return {
          bestTimes,
          hooks,
          sounds,
          posts,
        };
      });

      const bestTimes = payload.bestTimes
        .map((text: string) => normalizeTimeWindow(text))
        .filter((text: string | null): text is string => Boolean(text));
      const posts: PostAnalytics[] = payload.posts.map((post: any, index: number) => ({
        id: post.url ?? `${HANDLE}-${index}`,
        views: Number(post.views ?? 0),
        likes: Number(post.likes ?? 0),
        comments: Number(post.comments ?? 0),
        caption: typeof post.caption === 'string' ? post.caption : undefined,
        sound: undefined,
        url: typeof post.url === 'string' ? post.url : undefined,
        postedAt: nowIso(),
      }));

      return {
        bestTimes: bestTimes.length ? bestTimes : DEFAULT_BEST_TIMES,
        trendingHooks: payload.hooks.length ? payload.hooks : [],
        trendingSounds: payload.sounds.length ? payload.sounds : [],
        posts,
        fetchedAt: nowIso(),
        averageViews: posts.length ? posts.reduce((acc, cur) => acc + cur.views, 0) / posts.length : undefined,
        source: 'scrape',
      };
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.warn('[social-autopilot] Analytics scrape failed:', err);
    return null;
  }
}

async function fallbackAnalytics(queue: QueueState): Promise<AnalyticsSnapshot> {
  const fallbackTimes = [...DEFAULT_BEST_TIMES];
  try {
    const schedule = await buildSchedule();
    const mainAccount = schedule.find((entry) => entry.account.role === 'main');
    if (mainAccount) {
      const time = `${mainAccount.nextPost.getHours().toString().padStart(2, '0')}:${mainAccount.nextPost
        .getMinutes()
        .toString()
        .padStart(2, '0')}`;
      fallbackTimes.unshift(time);
    }
  } catch (err) {
    console.warn('[social-autopilot] Failed to build fallback schedule:', err);
  }

  const queueAnalytics = queue.items
    .filter((item) => item.status === 'posted' && item.analytics)
    .map((item) => item.analytics!)
    .slice(-10);

  return {
    bestTimes: Array.from(new Set(fallbackTimes)),
    trendingHooks: ['Magnetic energy check'],
    trendingSounds: ['#trending'],
    posts: queueAnalytics,
    averageViews:
      queueAnalytics.length
        ? queueAnalytics.reduce((acc, cur) => acc + cur.views, 0) / queueAnalytics.length
        : undefined,
    fetchedAt: nowIso(),
    source: 'fallback',
  };
}

async function collectAnalytics(
  queue: QueueState,
  sessions: TikTokSession[],
): Promise<AnalyticsSnapshot> {
  const api = await pullAnalyticsFromApi();
  if (api) {
    return api;
  }
  const main = sessions.find((session) => session.type === 'main');
  const scraped = await scrapeAnalytics(main);
  if (scraped) {
    return scraped;
  }
  const fallback = await fallbackAnalytics(queue);
  const trends = await analyzeTrends({ handle: HANDLE }).catch(() => null);
  if (trends && Array.isArray((trends as any).timingWindows)) {
    const extraTimes = (trends as any).timingWindows
      .map((value: string) => normalizeTimeWindow(value))
      .filter((value): value is string => Boolean(value));
    fallback.bestTimes = Array.from(new Set([...extraTimes, ...fallback.bestTimes]));
  }
  if (trends && Array.isArray((trends as any).topTrends)) {
    const hooks = (trends as any).topTrends
      .map((trend: any) => (typeof trend === 'string' ? trend : trend?.title))
      .filter((value: unknown): value is string => typeof value === 'string');
    if (hooks.length) {
      fallback.trendingHooks = hooks;
    }
  }
  fallback.fetchedAt = nowIso();
  fallback.source = 'fallback';
  return fallback;
}

function findDueItems(queue: QueueState, now = new Date()): QueueItem[] {
  return queue.items
    .filter((item) => item.status !== 'posted')
    .filter((item) => new Date(item.scheduledTime).getTime() <= now.getTime())
    .sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());
}

function scheduleRetry(queue: QueueState, analytics: AnalyticsSnapshot, base: Date, attempts: number): string {
  const offset = Math.min(attempts + 1, 6) * 45;
  const next = computeNextSchedule(analytics.bestTimes, queue, base, offset);
  return next.toISOString();
}

async function fetchPostPerformance(
  queue: QueueState,
  analytics: AnalyticsSnapshot,
  item: QueueItem,
): Promise<PostAnalytics | null> {
  if (analytics.posts.length) {
    const matched = analytics.posts.find((post) => post.caption?.includes(item.trackingTag));
    if (matched) {
      return matched;
    }
  }
  const fallback = queue.items
    .filter((entry) => entry.status === 'posted' && entry.analytics)
    .map((entry) => entry.analytics!);
  const matched = fallback.find((entry) => entry.id === item.analytics?.id);
  return matched ?? null;
}

async function detectFlops(
  queue: QueueState,
  analytics: AnalyticsSnapshot,
  now = new Date(),
): Promise<QueueItem[]> {
  const results: QueueItem[] = [];
  for (const item of queue.items) {
    if (item.status !== 'posted' || !item.postedAt) continue;
    if (!item.analytics) continue;
    const postedAt = new Date(item.postedAt);
    if (now.getTime() - postedAt.getTime() < HOURS_24) continue;
    if (item.attempts >= MAX_RETRIES) continue;
    const metrics = await fetchPostPerformance(queue, analytics, item);
    if (!metrics) continue;
    item.analytics = metrics;
    if (metrics.views >= FLOP_VIEW_THRESHOLD) continue;

    item.status = 'retry';
    item.attempts += 1;
    item.scheduledTime = scheduleRetry(queue, analytics, now, item.attempts);
    item.history.push(`retry-scheduled:${item.scheduledTime}`);
    results.push(item);
  }
  return results;
}

function summarizeQueue(queue: QueueState): string {
  const nextQueued = queue.items
    .filter((item) => item.status !== 'posted')
    .sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());
  const next = nextQueued[0];
  if (!next) return 'No pending posts.';
  return `Next: ${next.driveName} at ${new Date(next.scheduledTime).toLocaleString()}`;
}

async function sendTelegramUpdate(message: string): Promise<void> {
  const res = await sendTelegramMessage(`${TELEGRAM_PREFIX}\n${message}`);
  if (!res.ok) {
    console.warn('[social-autopilot] Telegram send failed:', res.error);
  }
}
function pruneQueue(queue: QueueState): void {
  const posted = queue.items.filter((item) => item.status === 'posted' && item.postedAt);
  if (posted.length > 40) {
    posted.sort((a, b) => new Date(b.postedAt ?? 0).getTime() - new Date(a.postedAt ?? 0).getTime());
    const keep = new Set(posted.slice(0, 40).map((item) => item.id));
    queue.items = queue.items.filter((item) => item.status !== 'posted' || keep.has(item.id));
  }
}

async function runAutopilot(): Promise<void> {
  const queue = await loadQueueState();
  const sessions = getSessions();
  const mainSession = sessions.find((session) => session.type === 'main');
  const boosterSessions = sessions.filter((session) => session.type === 'booster');

  const analytics = await collectAnalytics(queue, sessions);
  queue.lastAnalyticsSync = analytics.fetchedAt;

  let queueChanged = false;
  let telegramNeeded = false;

  let newFiles: drive_v3.Schema$File[] = [];
  try {
    newFiles = await fetchDriveVideos(queue);
  } catch (err) {
    console.warn('[social-autopilot] Drive sync failed:', err);
  }

  const newlyQueued = await enqueueNewVideos(queue, newFiles, analytics);
  if (newlyQueued.length) {
    queueChanged = true;
    telegramNeeded = true;
  }

  const now = new Date();
  const dueItems = findDueItems(queue, now).filter((item) => item.attempts < MAX_RETRIES);
  const outcomes: PostOutcome[] = [];
  const failures: { item: QueueItem; error: Error }[] = [];

  if (dueItems.length && !mainSession) {
    const message = 'Main TikTok session missing; cannot post due items.';
    console.warn('[social-autopilot]', message);
    for (const item of dueItems) {
      item.lastError = message;
      item.attempts += 1;
      item.status = 'retry';
      item.scheduledTime = scheduleRetry(queue, analytics, now, item.attempts);
      item.history.push(`retry-no-session:${item.scheduledTime}`);
    }
    queueChanged = true;
    telegramNeeded = true;
  } else {
    for (const item of dueItems) {
      if (!mainSession) break;
      item.history.push(`attempt:${nowIso()}`);
      try {
        const outcome = await postToTikTok(item, mainSession, analytics, boosterSessions);
        outcomes.push(outcome);
        queueChanged = true;
        telegramNeeded = true;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        item.status = 'retry';
        item.attempts += 1;
        item.lastError = error.message;
        item.scheduledTime = scheduleRetry(queue, analytics, now, item.attempts);
        item.history.push(`retry:${item.scheduledTime}`);
        failures.push({ item, error });
        queueChanged = true;
        telegramNeeded = true;
      }
    }
  }

  const flops = await detectFlops(queue, analytics, now);
  if (flops.length) {
    queueChanged = true;
    telegramNeeded = true;
  }

  pruneQueue(queue);

  if (queueChanged) {
    await persistQueueState(queue);
  }

  const messages: string[] = [];
  if (newlyQueued.length) {
    messages.push(`• Queued ${newlyQueued.length} new video${newlyQueued.length === 1 ? '' : 's'} from Drive.`);
  }
  for (const outcome of outcomes) {
    messages.push(`• ✅ ${outcome.message}`);
  }
  for (const { item, error } of failures) {
    messages.push(
      `• ⚠️ Failed to post ${item.driveName}: ${error.message}. Retry at ${new Date(
        item.scheduledTime,
      ).toLocaleString()}.`,
    );
  }
  if (flops.length) {
    messages.push(`• ♻️ Scheduled ${flops.length} flop retry${flops.length === 1 ? '' : 's'}.`);
  }
  if (queue.items.length) {
    messages.push(`• ${summarizeQueue(queue)}`);
  }

  if (telegramNeeded && messages.length) {
    await sendTelegramUpdate(messages.join('\n'));
  }

  if (!newlyQueued.length && !dueItems.length && !flops.length) {
    console.log('[social-autopilot] No actions required.');
  } else {
    console.log('[social-autopilot] Cycle complete.');
  }
}

runAutopilot()
  .then(() => {
    console.log('[social-autopilot] Finished run.');
  })
  .catch((err) => {
    console.error('[social-autopilot] Fatal error', err);
    process.exitCode = 1;
  });
