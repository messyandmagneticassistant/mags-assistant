import { getDb } from './db.js';

export interface VideoMeta {
  title?: string;
  type?: string;
  emotion?: string;
  timestamp?: string;
  quality?: string;
  source_path?: string;
  final_filename?: string;
  tiktok_link?: string;
  capcut_template?: string;
  persons?: string[];
}

export function addVideo(meta: VideoMeta) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO videos (title, type, emotion, timestamp, quality, source_path, final_filename, tiktok_link, capcut_template)
     VALUES (@title, @type, @emotion, @timestamp, @quality, @source_path, @final_filename, @tiktok_link, @capcut_template)`
  );
  const res = stmt.run(meta);
  const videoId = Number(res.lastInsertRowid);
  if (meta.persons && meta.persons.length) {
    const placeholders = meta.persons.map(() => '?').join(',');
    const faces = db
      .prepare(`SELECT id FROM faces WHERE name IN (${placeholders})`)
      .all(...meta.persons);
    const insert = db.prepare(`INSERT INTO video_faces (video_id, face_id) VALUES (?, ?)`);
    for (const f of faces) insert.run(videoId, f.id);
  }
  return videoId;
}
