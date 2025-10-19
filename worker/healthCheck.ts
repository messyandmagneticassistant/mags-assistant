import type { Env } from './lib/env';
import { gatherStatus } from './index';
import { sendTelegram } from './lib/state';
import { logHealthStatusToGitHub } from './lib/github';

type HealthSummary = {
  message: string;
  warnings: string[];
  postedTo: { telegram?: boolean; github?: boolean };
};

function describeMode(paused: boolean, tasks: string[]): 'paused' | 'idle' | 'running' {
  if (paused) return 'paused';
  const active = tasks.filter((task) => task && !task.toLowerCase().startsWith('idle'));
  return active.length ? 'running' : 'idle';
}

function formatList(items: string[], limit = 3): string {
  if (!items.length) return 'none';
  const trimmed = items.slice(0, limit);
  const suffix = items.length > limit ? ` …(+${items.length - limit})` : '';
  return `${trimmed.join(', ')}${suffix}`;
}

function formatDurationSince(iso: string | null | undefined, now: Date): { label: string; minutesAgo: number | null } {
  if (!iso) return { label: 'unknown', minutesAgo: null };
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return { label: iso, minutesAgo: null };
  const diffMs = now.getTime() - parsed.getTime();
  const minutesAgo = diffMs / 60000;
  if (!Number.isFinite(minutesAgo)) return { label: iso, minutesAgo: null };
  const rounded = Math.round(minutesAgo * 10) / 10;
  return { label: `${iso} (${rounded}m ago)`, minutesAgo };
}

function buildGitHubBody(nowIso: string, mode: string, tasks: string[], snapshot: any, warnings: string[]): string {
  const lines = [
    `### Hourly Maggie health (${nowIso})`,
    `- Mode: **${mode}**`,
    `- Active tasks: ${tasks.length ? tasks.map((task, idx) => `${idx + 1}. ${task}`).join(' / ') : 'none'}`,
    `- Scheduled posts: ${snapshot.scheduledPosts}`,
    `- Retry queue: ${snapshot.retryQueue} (next: ${snapshot.nextRetryAt ?? 'n/a'})`,
  ];

  const lastTick = snapshot?.runtime?.lastTick ?? null;
  if (lastTick) {
    const { label } = formatDurationSince(lastTick, new Date(nowIso));
    lines.push(`- Last tick: ${label}`);
  }

  if (warnings.length) {
    lines.push(`- ⚠️ Warnings: ${warnings.join('; ')}`);
  } else {
    lines.push('- ✅ No warnings detected.');
  }

  return lines.join('\n');
}

function buildTelegramMessage(nowIso: string, mode: string, tasks: string[], snapshot: any, warnings: string[]): string {
  const lines = [
    `⏱️ Hourly health ping @ ${nowIso}`,
    `• Mode: ${mode}`,
    `• Tasks: ${formatList(tasks)}`,
    `• Scheduled posts: ${snapshot.scheduledPosts}`,
    `• Retry queue: ${snapshot.retryQueue} (next: ${snapshot.nextRetryAt ?? 'n/a'})`,
  ];

  if (warnings.length) {
    lines.push(`• ⚠️ ${warnings.join(' | ')}`);
  } else {
    lines.push('• ✅ All systems nominal');
  }

  return lines.join('\n');
}

export async function runHourlyHealthCheck(env: Env): Promise<HealthSummary> {
  const { snapshot } = await gatherStatus(env);
  const now = new Date();
  const nowIso = now.toISOString();
  const tasks = Array.isArray(snapshot.currentTasks)
    ? (snapshot.currentTasks as string[]).filter((task) => typeof task === 'string' && task.trim())
    : [];
  const mode = describeMode(Boolean(snapshot.paused), tasks);

  const warnings: string[] = [];
  const lastTick = snapshot?.runtime?.lastTick ?? null;
  const lastTickInfo = formatDurationSince(lastTick, now);
  if (lastTickInfo.minutesAgo !== null && lastTickInfo.minutesAgo > 20) {
    warnings.push(`Last tick ${Math.round(lastTickInfo.minutesAgo)}m ago`);
  }
  if (snapshot.paused) {
    warnings.push('Schedulers paused');
  }
  if (snapshot.retryQueue > 5) {
    warnings.push(`Retry queue high (${snapshot.retryQueue})`);
  }

  const telegramMessage = buildTelegramMessage(nowIso, mode, tasks, snapshot, warnings);
  let telegramPosted = false;
  try {
    await sendTelegram(env, telegramMessage);
    telegramPosted = true;
  } catch (err) {
    console.warn('[health] Failed to send Telegram health update', err);
  }

  const githubBody = buildGitHubBody(nowIso, mode, tasks, snapshot, warnings);
  let githubPosted = false;
  const githubResult = await logHealthStatusToGitHub(env as any, githubBody);
  if (githubResult.ok) {
    githubPosted = true;
  } else if (!githubResult.skipped) {
    console.warn('[health] Failed to log health to GitHub', githubResult);
  }

  return {
    message: githubBody,
    warnings,
    postedTo: { telegram: telegramPosted || undefined, github: githubPosted || undefined },
  };
}

