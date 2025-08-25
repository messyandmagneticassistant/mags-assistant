import { getDb } from './db.js';

export interface PerformanceInput {
  videoId: number;
  view_count: number;
  likes: number;
  comments: number;
  shares: number;
  sound?: string;
  caption?: string;
  reposts?: number;
}

export function updatePerformance(p: PerformanceInput) {
  const db = getDb();
  const flop = p.view_count < 1000 ? 1 : 0;
  const viral = p.view_count > 100000 ? 1 : 0;
  const stmt = db.prepare(`
    INSERT INTO performance (video_id, view_count, likes, comments, shares, sound, caption, reposts, is_flop, is_viral)
    VALUES (@videoId, @view_count, @likes, @comments, @shares, @sound, @caption, @reposts, @flop, @viral)
    ON CONFLICT(video_id) DO UPDATE SET
      view_count=excluded.view_count,
      likes=excluded.likes,
      comments=excluded.comments,
      shares=excluded.shares,
      sound=COALESCE(excluded.sound, sound),
      caption=COALESCE(excluded.caption, caption),
      reposts=COALESCE(excluded.reposts, reposts),
      is_flop=excluded.is_flop,
      is_viral=excluded.is_viral,
      last_updated=CURRENT_TIMESTAMP
  `);
  stmt.run({ ...p, flop, viral });
}
