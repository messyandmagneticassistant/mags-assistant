import { promises as fs } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';

export type BrainDocument = Record<string, unknown> & {
  lastUpdated?: string;
  lastSynced?: string | null;
};

const FRONT_MATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
const ROOT = process.cwd();
const BRAIN_DIR = path.resolve(ROOT, 'brain');
const BRAIN_MD = path.join(BRAIN_DIR, 'brain.md');
const BRAIN_JSON = path.join(BRAIN_DIR, 'brain.json');
const KV_STATE_JSON = path.resolve(ROOT, 'config', 'kv-state.json');

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

function parseFrontMatter(raw: string): BrainDocument | null {
  const match = raw.match(FRONT_MATTER_REGEX);
  if (!match) return null;
  try {
    const data = parseYaml(match[1]);
    if (data && typeof data === 'object') {
      return data as BrainDocument;
    }
  } catch (err) {
    console.warn('[readBrain] Failed to parse YAML front matter:', err);
  }
  return null;
}

async function readFromMarkdown(): Promise<BrainDocument | null> {
  const raw = await readFileIfExists(BRAIN_MD);
  if (!raw) return null;
  const parsed = parseFrontMatter(raw);
  if (parsed) {
    return parsed;
  }
  console.warn('[readBrain] No YAML front matter found in brain.md; skipping.');
  return null;
}

async function readFromJson(): Promise<BrainDocument | null> {
  const raw = await readFileIfExists(BRAIN_JSON);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      return data as BrainDocument;
    }
  } catch (err) {
    console.warn('[readBrain] Failed to parse brain.json:', err);
  }
  return null;
}

async function readFromKvState(): Promise<BrainDocument | null> {
  const raw = await readFileIfExists(KV_STATE_JSON);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      return data as BrainDocument;
    }
  } catch (err) {
    console.warn('[readBrain] Failed to parse config/kv-state.json:', err);
  }
  return null;
}

export async function readBrain(): Promise<BrainDocument> {
  const sources: Array<() => Promise<BrainDocument | null>> = [
    readFromMarkdown,
    readFromJson,
    readFromKvState,
  ];

  for (const source of sources) {
    const result = await source();
    if (result) {
      return result;
    }
  }

  console.warn('[readBrain] Falling back to empty brain payload.');
  return {};
}

export default readBrain;
