import { promises as fs } from 'fs';
import path from 'path';
export type BrainDocument = Record<string, unknown> & {
  lastUpdated?: string;
  lastSynced?: string | null;
};

const ROOT = process.cwd();
const BRAIN_DIR = path.resolve(ROOT, 'brain');
const BRAIN_JSON = path.join(BRAIN_DIR, 'brain.json');

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
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

export async function readBrain(): Promise<BrainDocument> {
  const payload = await readFromJson();
  if (payload) {
    return payload;
  }

  console.warn('[readBrain] Falling back to empty brain payload.');
  return {};
}

export default readBrain;
