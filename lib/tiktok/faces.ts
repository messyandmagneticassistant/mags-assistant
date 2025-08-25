import { getDb } from './db.js';

export interface FaceEncoding {
  name: string;
  encoding: number[];
}

function encodeBuffer(arr: number[]) {
  return Buffer.from(JSON.stringify(arr));
}

function decodeBuffer(buf: Buffer) {
  return JSON.parse(buf.toString()) as number[];
}

export function saveFace({ name, encoding }: FaceEncoding) {
  const db = getDb();
  const stmt = db.prepare(`INSERT OR REPLACE INTO faces (name, encoding) VALUES (?, ?)`);
  const info = stmt.run(name, encodeBuffer(encoding));
  return Number(info.lastInsertRowid);
}

export function matchFace(encoding: number[], threshold = 0.6) {
  const db = getDb();
  const faces = db.prepare(`SELECT name, encoding FROM faces`).all();
  let match: string | null = null;
  let best = threshold;
  for (const f of faces) {
    const enc = decodeBuffer(f.encoding);
    const dist = Math.sqrt(enc.reduce((acc, val, i) => acc + (val - encoding[i]) ** 2, 0));
    if (dist < best) {
      best = dist;
      match = f.name;
    }
  }
  return match;
}
