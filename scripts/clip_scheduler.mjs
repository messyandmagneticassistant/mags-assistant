import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import { makeCaption } from './lib/captions.mjs';
import { postToTikTok } from './lib/tiktok_post.mjs';

const DATA_DIR = path.join(process.cwd(), 'data');
const QUEUE_PATH = path.join(DATA_DIR, 'schedule_queue.json');
const LOG_PATH = path.join(DATA_DIR, 'post_log.json');

async function loadJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function saveJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function loadConfig() {
  const configPath = path.join(process.cwd(), 'public', 'mags-config.json');
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch {
    return { preferredPostingHours: [9, 12, 15, 19, 21], caption: { defaultCTA: '' } };
  }
}

function nextSlotAfter(refDate, hours) {
  let ref = new Date(refDate);
  while (true) {
    const candidates = hours
      .map(h => {
        const d = new Date(ref);
        d.setHours(h, 0, 0, 0);
        return d;
      })
      .filter(d => d > ref);
    if (candidates.length) {
      candidates.sort((a, b) => a - b);
      return candidates[0];
    }
    ref.setDate(ref.getDate() + 1);
    ref.setHours(0, 0, 0, 0);
  }
}

function chooseCookie(account) {
  const map = {
    main: process.env.TIKTOK_COOKIE_MAIN,
    willow: process.env.TIKTOK_COOKIE_WILLOW,
    fairyfarm: process.env.TIKTOK_COOKIE_FAIRYFARM,
  };
  return map[account] || map.main;
}

async function generateText(clipName, config, hints) {
  const title = clipName;
  const baseCaption = makeCaption({ title, cta: config.defaultCTA });
  if (!process.env.OPENAI_API_KEY) {
    return { title, caption: baseCaption, hashtags: '', alt_text: '' };
  }
  const prompt = `Title: ${title}\nHints: ${hints}\nGenerate JSON with title, caption, hashtags, alt_text. Hashtags <=2200 chars.`;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      }),
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    const json = JSON.parse(text || '{}');
    return {
      title: json.title || title,
      caption: json.caption || baseCaption,
      hashtags: json.hashtags || '',
      alt_text: json.alt_text || '',
    };
  } catch {
    return { title, caption: baseCaption, hashtags: '', alt_text: '' };
  }
}

async function findReadyClips(log, queue) {
  const readyIndex = path.join(DATA_DIR, 'ready_clips.json');
  let clips = [];
  if (fssync.existsSync(readyIndex)) {
    clips = await loadJSON(readyIndex, []);
  } else {
    const outDir = path.join(process.cwd(), 'outputs');
    if (fssync.existsSync(outDir)) {
      const files = await fs.readdir(outDir);
      clips = files.filter(f => f.endsWith('.mp4')).map(f => path.join(outDir, f));
    }
  }
  const seen = new Set([...log, ...queue].map(e => e.clip));
  return clips.filter(c => !seen.has(c));
}

async function createNotionRow(item) {
  const token = process.env.NOTION_TOKEN;
  const db = process.env.HQ_DATABASE_ID;
  if (!token || !db) return;
  try {
    await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        parent: { database_id: db },
        properties: {
          Title: { title: [{ text: { content: item.clip } }] },
          Status: { select: { name: item.status } },
          Platform: { select: { name: 'TikTok' } },
          Time: { date: { start: item.when } },
          Account: { rich_text: [{ text: { content: item.account } }] },
          Caption: { rich_text: [{ text: { content: item.caption } }] },
          Hashtags: { rich_text: [{ text: { content: item.hashtags } }] },
          FileRef: { url: item.clip },
        },
      }),
    });
  } catch {
    // ignore
  }
}

async function notifyTelegram(scheduled, posted) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  const parts = [];
  if (scheduled.length) {
    const time = new Date(scheduled[0].when).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    parts.push(`📆 Scheduled ${scheduled.length} clips (first at ${time}).`);
  }
  if (posted.length) {
    parts.push(`⬆️ Posted ${posted.length} clip${posted.length > 1 ? 's' : ''}.`);
  }
  if (!parts.length) parts.push('📭 No clips scheduled or posted.');
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: parts.join('\n') }),
    });
  } catch {
    // ignore
  }
}

async function main() {
  const config = await loadConfig();
  const hours = config.preferredPostingHours || [9, 12, 15, 19, 21];
  const hints = fssync.existsSync('docs/brain.md') ? await fs.readFile('docs/brain.md', 'utf8') : '';

  const queue = await loadJSON(QUEUE_PATH, []);
  const log = await loadJSON(LOG_PATH, []);
  const now = new Date();

  const remaining = [];
  const posted = [];

  for (const item of queue) {
    if (new Date(item.when) <= now) {
      const cookie = chooseCookie(item.account || 'main');
      if (cookie) {
        const res = await postToTikTok({ clipPath: item.clip, caption: item.caption, cookie });
        if (res.ok) {
          log.push({ clip: item.clip, account: item.account, status: 'Posted', when: now.toISOString(), postUrl: res.postUrl });
          posted.push({ ...item, postUrl: res.postUrl });
          continue;
        } else {
          log.push({ clip: item.clip, account: item.account, status: 'Error', when: now.toISOString(), error: res.error });
        }
      }
      remaining.push(item);
    } else {
      remaining.push(item);
    }
  }

  let ref = new Date(Math.max(now, ...remaining.map(r => new Date(r.when).getTime()), 0));
  const ready = await findReadyClips(log, remaining);
  const scheduled = [];

  for (const clip of ready) {
    ref = nextSlotAfter(ref, hours);
    const text = await generateText(path.basename(clip), config.caption || {}, hints);
    const entry = { clip, when: ref.toISOString(), account: 'main', caption: text.caption, hashtags: text.hashtags };
    remaining.push(entry);
    log.push({ clip, account: 'main', status: 'Scheduled', when: entry.when });
    scheduled.push(entry);
    await createNotionRow({ ...entry, status: 'Scheduled' });
  }

  await saveJSON(QUEUE_PATH, remaining);
  await saveJSON(LOG_PATH, log);

  await notifyTelegram(scheduled, posted);
}

main();
