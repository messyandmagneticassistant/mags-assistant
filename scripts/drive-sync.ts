import fs from 'fs';
import path from 'path';

const force = process.argv[2] === 'true';
const rawFolder = process.env.RAW_DRIVE_FOLDER || '';
const workDir = path.join(process.cwd(), 'work', 'incoming');
const cursorPath = path.join(process.cwd(), 'work', 'drive-cursor.json');

fs.mkdirSync(workDir, { recursive: true });

interface Cursor { lastSync: string }

const cursor: Cursor = fs.existsSync(cursorPath)
  ? JSON.parse(fs.readFileSync(cursorPath, 'utf8'))
  : { lastSync: '' };

if (force) cursor.lastSync = '';

// TODO: List Google Drive files newer than cursor.lastSync
// Placeholder implementation simply logs.
console.log('[drive-sync] RAW_DRIVE_FOLDER=%s', rawFolder);

// Update cursor to now
cursor.lastSync = new Date().toISOString();
fs.writeFileSync(cursorPath, JSON.stringify(cursor));
