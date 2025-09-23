import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { selfHeal } from './selfHeal';
import { sendTelegramMessage } from './lib/telegramClient';

interface BoosterPlan {
  handle: string;
  offsetSec: number;
}

interface ActionLog {
  ok: boolean;
  message: string;
}

async function loadBoosterHandles(): Promise<string[]> {
  try {
    const raw = await readFile('data/accounts.json', 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((entry) => entry?.role === 'booster' && typeof entry?.username === 'string')
      .map((entry) => String(entry.username))
      .filter((value, index, array) => value.trim().length > 0 && array.indexOf(value) === index);
  } catch (err) {
    console.warn('[runMaggie] Unable to load booster handles:', err);
    return [];
  }
}

function buildBoosterPlan(handles: string[]): BoosterPlan[] {
  return handles.map((handle, index) => ({ handle, offsetSec: 45 * (index + 1) }));
}

async function orchestrateTikTok(workerUrl: string): Promise<ActionLog[]> {
  const logs: ActionLog[] = [];
  const base = workerUrl.replace(/\/$/, '');

  const boosters = buildBoosterPlan(await loadBoosterHandles());
  if (boosters.length) {
    try {
      const res = await fetch(`${base}/tiktok/eng/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boosters,
          source: 'github-action',
          triggeredAt: new Date().toISOString(),
        }),
      });
      if (res.ok) {
        logs.push({ ok: true, message: `Queued booster engagement for ${boosters.length} handle(s).` });
      } else {
        const detail = await res.text().catch(() => '');
        logs.push({ ok: false, message: `Failed to queue boosters (HTTP ${res.status} ${detail})` });
      }
    } catch (err) {
      logs.push({ ok: false, message: `Booster request error: ${err instanceof Error ? err.message : String(err)}` });
    }
  } else {
    logs.push({ ok: false, message: 'No booster handles configured.' });
  }

  const whenISO = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  try {
    const res = await fetch(`${base}/tiktok/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ whenISO }),
    });
    if (res.ok) {
      logs.push({ ok: true, message: `Scheduled next TikTok run for ${whenISO}.` });
    } else {
      logs.push({ ok: false, message: `Failed to schedule TikTok run (HTTP ${res.status}).` });
    }
  } catch (err) {
    logs.push({ ok: false, message: `TikTok schedule error: ${err instanceof Error ? err.message : String(err)}` });
  }

  try {
    const res = await fetch(`${base}/tiktok/review-queue`);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const length = Array.isArray(data?.review) ? data.review.length : 0;
      logs.push({ ok: true, message: `Review queue currently has ${length} item(s).` });
    } else {
      logs.push({ ok: false, message: `Unable to read review queue (HTTP ${res.status}).` });
    }
  } catch (err) {
    logs.push({ ok: false, message: `Review queue error: ${err instanceof Error ? err.message : String(err)}` });
  }

  return logs;
}

function summarizeActions(actions: ActionLog[]): string {
  return actions
    .map((action) => `${action.ok ? '✅' : '⚠️'} ${action.message}`)
    .join('\n');
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log('[runMaggie] Social loop starting at', startedAt);
  await sendTelegramMessage('📣 <b>Maggie social loop</b> run started.').catch(() => undefined);

  const healSummary = await selfHeal({ triggeredBy: 'social-loop', notify: false });
  const healLines = healSummary.results
    .map((result) => {
      const icon =
        result.status === 'ok'
          ? '✅'
          : result.status === 'recovered'
            ? '🟡'
            : result.status === 'skipped'
              ? '⚪️'
              : '❌';
      return `${icon} <b>${result.service}</b> — ${result.message}`;
    })
    .join('\n');

  const workerUrl = process.env.WORKER_URL || process.env.WORKER_BASE_URL || '';
  let actionLines = '⚠️ WORKER_URL not configured — skipped TikTok orchestration.';
  if (workerUrl) {
    const actions = await orchestrateTikTok(workerUrl);
    actionLines = summarizeActions(actions);
  }

  const finishedAt = new Date().toISOString();
  console.log('[runMaggie] Social loop finished at', finishedAt);

  const summaryMessage = [
    '📣 <b>Maggie social loop complete</b>',
    healLines,
    actionLines,
    `⏱️ <i>${startedAt} → ${finishedAt}</i>`,
  ]
    .filter(Boolean)
    .join('\n');

  await sendTelegramMessage(summaryMessage).catch(() => undefined);
}

main().catch((err) => {
  console.error('[runMaggie] Fatal error:', err);
  const message = err instanceof Error ? err.message : String(err);
  sendTelegramMessage(`❌ <b>Maggie social loop failed</b>\n<code>${message}</code>`).catch(() => undefined);
  process.exitCode = 1;
});
