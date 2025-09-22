import { promises as fs } from 'fs';
import path from 'path';

import { runWithCodex } from './lib/codex.ts';
import {
  getBlueprintSections,
  generateIconBundleFromReading,
} from './content/loader/blueprint';
import type { BlueprintTier } from './content/validators/blueprint-schema';

type AttemptLog = {
  provider: string;
  ok: boolean;
  startedAt: string;
  error?: string;
};

export interface MaggieFallbackResult {
  provider: string;
  output: unknown;
  attempts: AttemptLog[];
  notes?: string;
}

const SCHEDULE_FALLBACK_PATH = path.resolve('data', 'fallbacks', 'schedule.json');

function serializePayload(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function buildPrompt(taskName: string, payload: Record<string, unknown>): string {
  switch (taskName) {
    case 'blueprint': {
      const tier = String(payload.tier || 'lite').toLowerCase();
      const name = payload.name || payload.email || 'the client';
      const notes = payload.notes ? `Notes: ${payload.notes}` : '';
      return `Create a soul blueprint for ${name}. Tier: ${tier}. Emphasize mission, rhythm, and aligned offers. ${notes}`.trim();
    }
    case 'schedule': {
      const cadence = payload.cadence || 'daily';
      const focus = payload.focus || 'soul business visibility';
      return `Produce a ${cadence} content schedule for Maggie that advances ${focus}. Use warm, encouraging tone and include timing blocks with descriptions.`;
    }
    case 'icon': {
      return `Design icon bundle suggestions aligned to this reading context:\n${serializePayload(payload)}`;
    }
    default:
      return `Complete the task "${taskName}" using the following context:\n${serializePayload(payload)}`;
  }
}

function summarizeError(error: unknown): string {
  if (!error) return 'unknown';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function callClaude(prompt: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) {
    throw new Error('Missing ANTHROPIC_API_KEY');
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Claude error ${res.status}: ${JSON.stringify(json)}`);
  }
  const text = json?.content?.[0]?.text || json?.content?.map?.((p: any) => p?.text)?.join('\n');
  if (!text) {
    throw new Error('Claude returned empty response');
  }
  return text;
}

async function callGemini(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('Missing GEMINI_API_KEY');
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4 },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Gemini error ${res.status}: ${JSON.stringify(json)}`);
  }
  const text =
    json?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').join('\n') || '';
  if (!text.trim()) {
    throw new Error('Gemini returned empty response');
  }
  return text.trim();
}

async function loadScheduleFallback() {
  try {
    const raw = await fs.readFile(SCHEDULE_FALLBACK_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadBlueprintFallback(tier: BlueprintTier) {
  try {
    const sections = getBlueprintSections(tier);
    return { tier, sections };
  } catch (err) {
    return { tier, error: summarizeError(err) };
  }
}

async function loadIconFallback(payload: Record<string, unknown>) {
  try {
    const bundle = generateIconBundleFromReading((payload.reading || {}) as any);
    return {
      bundle,
      note: 'Fallback icon bundle generated from last saved reading.',
    };
  } catch (err) {
    return {
      icons: Array.isArray(payload.icons) ? payload.icons : [],
      note: `Fallback icon bundle failed to generate: ${summarizeError(err)}`,
    };
  }
}

async function loadLastSavedVersion(
  taskName: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  if (taskName === 'blueprint') {
    const rawTier = String(payload.tier || 'lite').toLowerCase();
    const allowed: BlueprintTier[] = ['full', 'mini', 'lite', 'realignment'];
    const tier = (allowed.includes(rawTier as BlueprintTier)
      ? (rawTier as BlueprintTier)
      : 'lite') as BlueprintTier;
    return loadBlueprintFallback(tier);
  }
  if (taskName === 'schedule') {
    return (await loadScheduleFallback()) || { title: 'Default schedule', days: [] };
  }
  if (taskName === 'icon') {
    return loadIconFallback(payload);
  }
  return { message: 'No cached version available', task: taskName, payload };
}

async function tryProvider(
  label: string,
  run: () => Promise<string>,
  attempts: AttemptLog[],
): Promise<MaggieFallbackResult | null> {
  const startedAt = new Date().toISOString();
  try {
    const output = await run();
    attempts.push({ provider: label, ok: true, startedAt });
    return { provider: label, output, attempts };
  } catch (err) {
    attempts.push({ provider: label, ok: false, startedAt, error: summarizeError(err) });
    return null;
  }
}

export async function runMaggieTaskWithFallback(
  taskName: string,
  payload: Record<string, unknown> = {}
): Promise<MaggieFallbackResult> {
  const prompt = buildPrompt(taskName, payload);
  const attempts: AttemptLog[] = [];

  const primary = await tryProvider(
    'GPT-4o',
    () =>
      runWithCodex({
        task: prompt,
        model: process.env.CODEX_MODEL || 'gpt-4o',
      }),
    attempts,
  );
  if (primary) return primary;

  const claude = await tryProvider('Claude 3', () => callClaude(prompt), attempts);
  if (claude) return claude;

  const gemini = await tryProvider('Gemini Pro', () => callGemini(prompt), attempts);
  if (gemini) return gemini;

  const fallback = await loadLastSavedVersion(taskName, payload);
  attempts.push({ provider: 'last-saved', ok: true, startedAt: new Date().toISOString() });
  return { provider: 'last-saved', output: fallback, attempts, notes: 'Used cached content' };
}
