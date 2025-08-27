// brain/index.ts
import fs from 'fs';
import path from 'path';
import { put, get } from '@cloudflare/kv-asset-handler'; // Optional KV sync

export interface BrainConfig {
  audience?: string;
  styleNaturalNotAI?: boolean;
  emotionRotation?: string[];
  personalAudience?: string[];
  history?: { ts: number; input: string; source?: string }[];
  [key: string]: any;
}

const MEMORY_FILE = path.join(__dirname, 'memory.json');
const KV_KEY = 'config:brain';

export async function loadBrain(): Promise<BrainConfig> {
  try {
    const raw = await fs.promises.readFile(MEMORY_FILE, 'utf8');
    const local = JSON.parse(raw);

    // Optionally sync with Cloudflare KV
    let remote = {};
    try {
      const kvData = await get(KV_KEY);
      if (kvData) remote = JSON.parse(kvData);
    } catch {}

    return {
      audience: 'general',
      styleNaturalNotAI: true,
      emotionRotation: ['joy', 'grief', 'silly'],
      personalAudience: [],
      history: [],
      ...remote,
      ...local,
    };
  } catch {
    return {
      audience: 'general',
      styleNaturalNotAI: true,
      emotionRotation: ['joy', 'grief', 'silly'],
      personalAudience: [],
      history: [],
    };
  }
}

export async function updateBrain(opts: {
  newInput: string;
  source?: string;
  wipe?: boolean;
}) {
  const brain = await loadBrain();

  if (opts.wipe) {
    brain.history = [];
  } else {
    brain.history ||= [];
    brain.history.push({
      ts: Date.now(),
      input: opts.newInput,
      source: opts.source || 'unknown',
    });
  }

  const data = JSON.stringify(brain, null, 2);
  await fs.promises.writeFile(MEMORY_FILE, data);

  // Optional Cloudflare KV sync
  try {
    await put(KV_KEY, data);
  } catch (err) {
    console.warn('[updateBrain] KV sync failed:', err);
  }
}