import { promises as fs, createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';

export interface StorageAdapter {
  put(file: Buffer | Readable, target: string): Promise<string>;
  get(target: string): Promise<Buffer>;
  exists(target: string): Promise<boolean>;
}

const ROOT = path.resolve(process.cwd(), 'media');

async function ensureDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

class LocalStorage implements StorageAdapter {
  async put(file: Buffer | Readable, target: string): Promise<string> {
    const full = path.join(ROOT, target);
    await ensureDir(full);
    if (file instanceof Readable) {
      const ws = createWriteStream(full);
      await new Promise((resolve, reject) => {
        file.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
      });
    } else {
      await fs.writeFile(full, file);
    }
    return full;
  }

  async get(target: string): Promise<Buffer> {
    const full = path.join(ROOT, target);
    return await fs.readFile(full);
  }

  async exists(target: string): Promise<boolean> {
    const full = path.join(ROOT, target);
    try {
      await fs.access(full);
      return true;
    } catch {
      return false;
    }
  }
}

class GoogleDriveStorage implements StorageAdapter {
  async put(file: Buffer | Readable, target: string): Promise<string> {
    throw new Error('Google Drive storage not configured');
  }
  async get(target: string): Promise<Buffer> {
    throw new Error('Google Drive storage not configured');
  }
  async exists(target: string): Promise<boolean> {
    return false;
  }
}

export function getStorage(): StorageAdapter {
  if (
    process.env.GOOGLE_CLIENT_EMAIL &&
    (process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_KEY_URL)
  ) {
    return new GoogleDriveStorage();
  }
  return new LocalStorage();
}
