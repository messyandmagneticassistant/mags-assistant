import { randomUUID } from 'crypto';
import path from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import type { OrderSummary } from './fulfillment/types';

export interface FulfillmentJob {
  id: string;
  source: 'stripe' | 'tally';
  payload: any;
  attempts: number;
  createdAt: string;
  metadata?: Record<string, any>;
}

interface QueueState {
  jobs: FulfillmentJob[];
  lastSummary?: OrderSummary | null;
}

const QUEUE_KEY = 'fulfillment:queue';
const LAST_KEY = 'fulfillment:last';
const FALLBACK_PATH = path.resolve(process.cwd(), 'queue.json');

let memoryState: QueueState | null = null;

function isNode(): boolean {
  return typeof process !== 'undefined' && !!process.versions?.node;
}

async function readFromEnv(env: any, key: string): Promise<string | null> {
  try {
    if (env?.BRAIN && typeof env.BRAIN.get === 'function') {
      const value = await env.BRAIN.get(key);
      if (typeof value === 'string') return value;
    }
  } catch (err) {
    console.warn('[queue] failed to read from env KV:', err);
  }
  return null;
}

async function writeToEnv(env: any, key: string, value: string): Promise<void> {
  try {
    if (env?.BRAIN && typeof env.BRAIN.put === 'function') {
      await env.BRAIN.put(key, value);
    }
  } catch (err) {
    console.warn('[queue] failed to write to env KV:', err);
  }
}

async function readFallback(): Promise<QueueState | null> {
  if (!isNode()) return null;
  try {
    const raw = await readFile(FALLBACK_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeFallback(state: QueueState): Promise<void> {
  if (!isNode()) return;
  try {
    await mkdir(path.dirname(FALLBACK_PATH), { recursive: true });
    await writeFile(FALLBACK_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn('[queue] failed to write fallback file:', err);
  }
}

async function loadState(env?: any): Promise<QueueState> {
  if (memoryState) return memoryState;
  const raw = await readFromEnv(env, QUEUE_KEY);
  if (raw) {
    try {
      memoryState = JSON.parse(raw);
      return memoryState!;
    } catch (err) {
      console.warn('[queue] failed to parse KV state:', err);
    }
  }
  const fallback = await readFallback();
  if (fallback) {
    memoryState = fallback;
    return fallback;
  }
  memoryState = { jobs: [], lastSummary: null };
  return memoryState;
}

async function saveState(state: QueueState, env?: any): Promise<void> {
  memoryState = state;
  const serialized = JSON.stringify(state);
  await writeToEnv(env, QUEUE_KEY, serialized);
  await writeFallback(state);
}

function ensureJob(job: Partial<FulfillmentJob>): FulfillmentJob {
  return {
    id: job.id || randomUUID(),
    source: job.source || 'stripe',
    payload: job.payload,
    attempts: job.attempts ?? 0,
    createdAt: job.createdAt || new Date().toISOString(),
    metadata: job.metadata || {},
  };
}

export async function enqueueFulfillmentJob(
  job: Partial<FulfillmentJob>,
  env?: any
): Promise<FulfillmentJob> {
  const state = await loadState(env);
  const full = ensureJob(job);
  state.jobs.push(full);
  await saveState(state, env);
  return full;
}

export async function dequeueFulfillmentJob(env?: any): Promise<FulfillmentJob | null> {
  const state = await loadState(env);
  const job = state.jobs.shift() || null;
  if (job) await saveState(state, env);
  return job;
}

export async function listQueuedJobs(env?: any): Promise<FulfillmentJob[]> {
  const state = await loadState(env);
  return [...state.jobs];
}

export async function requeueJob(job: FulfillmentJob, env?: any): Promise<void> {
  const state = await loadState(env);
  job.attempts += 1;
  state.jobs.push(job);
  await saveState(state, env);
}

export async function setLastOrderSummary(summary: OrderSummary, env?: any): Promise<void> {
  const state = await loadState(env);
  state.lastSummary = summary;
  await saveState(state, env);
  await writeToEnv(env, LAST_KEY, JSON.stringify(summary));
}

export async function getLastOrderSummary(env?: any): Promise<OrderSummary | null> {
  const state = await loadState(env);
  if (state.lastSummary) return state.lastSummary;
  const raw = await readFromEnv(env, LAST_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state.lastSummary = parsed;
      return parsed;
    } catch {}
  }
  const fallback = await readFallback();
  return fallback?.lastSummary ?? null;
}
