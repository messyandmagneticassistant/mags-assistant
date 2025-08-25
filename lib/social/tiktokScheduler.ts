import fs from 'node:fs/promises';
import path from 'node:path';

export interface TikTokAccount {
  id: string;
  username: string;
  alias: string;
  role: 'main' | 'booster';
  postFrequency: string;
  interact: boolean;
  lastPost?: string;
}

const ACCOUNTS_FILE = path.resolve(process.cwd(), 'data', 'accounts.json');

export async function loadAccounts(): Promise<TikTokAccount[]> {
  const txt = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
  return JSON.parse(txt) as TikTokAccount[];
}

function parseFrequency(freq: string): { posts: number; days: number } {
  const m = freq.match(/(\d+)x\/(\d+)?day/);
  if (!m) return { posts: 1, days: 1 };
  const posts = parseInt(m[1], 10);
  const days = m[2] ? parseInt(m[2], 10) : 1;
  return { posts, days };
}

function randomWithin(ms: number) {
  return Math.floor(Math.random() * ms);
}

export interface ScheduledPost {
  account: TikTokAccount;
  nextPost: Date;
  interactions: string[];
  filler: boolean;
}

export async function buildSchedule(now = new Date()): Promise<ScheduledPost[]> {
  const accounts = await loadAccounts();
  const schedule: ScheduledPost[] = [];

  for (const acct of accounts) {
    const { posts, days } = parseFrequency(acct.postFrequency);
    const intervalDays = days / posts;
    const last = acct.lastPost
      ? new Date(acct.lastPost)
      : new Date(now.getTime() - intervalDays * 24 * 60 * 60 * 1000);
    const next = new Date(
      last.getTime() +
        intervalDays * 24 * 60 * 60 * 1000 +
        randomWithin(2 * 60 * 60 * 1000)
    );

    const interactions: string[] = [];
    if (acct.interact) {
      const actions = ['like', 'comment'];
      interactions.push(actions[randomWithin(actions.length)]);
    }
    const filler = acct.role === 'booster' && Math.random() < 0.3;

    schedule.push({ account: acct, nextPost: next, interactions, filler });
  }

  schedule.sort((a, b) => a.nextPost.getTime() - b.nextPost.getTime());
  for (let i = 1; i < schedule.length; i++) {
    const prev = schedule[i - 1];
    const cur = schedule[i];
    if (cur.nextPost.getTime() - prev.nextPost.getTime() < 5 * 60 * 1000) {
      cur.nextPost = new Date(
        prev.nextPost.getTime() + 5 * 60 * 1000 + randomWithin(10 * 60 * 1000)
      );
    }
  }
  return schedule;
}

export function humanizeDelay() {
  const min = 30 * 1000;
  const max = 120 * 1000;
  return min + randomWithin(max - min);
}

export async function buildGmailFilters(accounts?: TikTokAccount[]) {
  const accs = accounts || (await loadAccounts());
  return accs.map((a) => ({
    alias: a.alias,
    filter: `to:${a.alias}`,
    label: `tiktok/${a.username}`,
  }));
}

export async function logScheduleToSheet(schedule: ScheduledPost[]) {
  // Placeholder: integrate with Google Sheets API
  console.log(
    '[tiktokScheduler] log to sheet',
    schedule.map((s) => ({
      alias: s.account.alias,
      username: s.account.username,
      session: s.account.id,
      lastPost: s.account.lastPost || null,
      nextPost: s.nextPost.toISOString(),
      queue: [s.nextPost.toISOString()],
    }))
  );
}
