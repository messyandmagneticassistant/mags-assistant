// src/social/score.ts
// Video scoring + edit suggestions

import { listRawFiles, DriveFile } from '../../scripts/drive';

export interface ScoredVideo {
  id: string;
  name: string;
  score: number;
}

/**
 * Scan raw folder for new videos and score them.
 */
export async function scoreBacklog(
  folder: string,
  kvGet: (key: string) => Promise<any>,
  kvPut: (key: string, val: any) => Promise<void>
): Promise<ScoredVideo[]> {
  const files: DriveFile[] = await listRawFiles(folder);
  const scored = files.map((f) => ({ id: f.id, name: f.name, score: Math.random() })).sort((a, b) => b.score - a.score);
  await kvPut('social:queue:tiktok', scored);
  const cursor = new Date().toISOString();
  await kvPut('social:cursor:drive:raw', cursor);
  return scored;
}
