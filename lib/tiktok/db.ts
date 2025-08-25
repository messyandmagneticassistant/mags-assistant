import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db: Database.Database;

export function getDb() {
  if (!db) {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, 'tiktok.sqlite');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    createTables();
  }
  return db;
}

function createTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS faces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      encoding BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      type TEXT,
      emotion TEXT,
      timestamp TEXT,
      quality TEXT,
      source_path TEXT,
      final_filename TEXT,
      tiktok_link TEXT,
      capcut_template TEXT
    );
    CREATE TABLE IF NOT EXISTS video_faces (
      video_id INTEGER,
      face_id INTEGER,
      FOREIGN KEY(video_id) REFERENCES videos(id),
      FOREIGN KEY(face_id) REFERENCES faces(id)
    );
    CREATE TABLE IF NOT EXISTS performance (
      video_id INTEGER PRIMARY KEY,
      view_count INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      is_flop INTEGER DEFAULT 0,
      is_viral INTEGER DEFAULT 0,
      reposts INTEGER DEFAULT 0,
      sound TEXT,
      caption TEXT,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(video_id) REFERENCES videos(id)
    );
    CREATE TABLE IF NOT EXISTS schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER,
      intended_time TEXT,
      sound TEXT,
      emotion TEXT,
      FOREIGN KEY(video_id) REFERENCES videos(id)
    );
  `);
}
