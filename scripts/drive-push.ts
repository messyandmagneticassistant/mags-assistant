import fs from 'fs';
import path from 'path';

const editedDir = path.join(process.cwd(), 'work', 'edited');
const files = fs.existsSync(editedDir) ? fs.readdirSync(editedDir) : [];

// TODO: Upload to Google Drive
console.log('[drive-push] files:', files);
