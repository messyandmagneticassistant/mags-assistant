import { getDb } from './db.js';

export interface ScheduleItem {
  videoId: number;
  intended_time: string; // ISO string
  sound?: string;
  emotion?: string;
}

export function schedulePost(item: ScheduleItem) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO schedule (video_id, intended_time, sound, emotion)
     VALUES (@videoId, @intended_time, @sound, @emotion)`
  );
  const res = stmt.run(item);
  return Number(res.lastInsertRowid);
}

export function dailySchedule(date: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM schedule WHERE date(intended_time)=date(?) ORDER BY intended_time LIMIT 12`
    )
    .all(date);
}
