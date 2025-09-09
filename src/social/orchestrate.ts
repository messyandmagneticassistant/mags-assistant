import fs from 'fs';
import path from 'path';
import { schedule } from './scheduler';
import { classifyFrame, redactRegions } from './safety';

// TODO: real Google Drive integration. For now just stub out a fetcher.
async function fetchDriveQueue(): Promise<string[]> {
  // pull list of raw video URLs from a Drive folder
  return [];
}

async function download(_url: string): Promise<string> {
  // stub: download file and return local path
  return _url;
}

async function applyCapCutTemplate(file: string): Promise<string> {
  // If CAPCUT_TEMPLATE_ID is set, transform the video via CapCut templates.
  if (process.env.CAPCUT_TEMPLATE_ID) {
    // TODO: integrate CapCut editing
  }
  return file;
}

// choose a directory for transient CI artifacts
const QUEUE_DIR = process.env.QUEUE_DIR ?? 'tmp';
const queuePath = path.join(process.cwd(), QUEUE_DIR, 'queue.json');

const dryrun = process.argv.includes('--dryrun');

async function main() {
  const queue: any[] = fs.existsSync(queuePath) ? JSON.parse(fs.readFileSync(queuePath, 'utf8')) : [];

  // Augment queue with new files from Drive
  const driveFiles = await fetchDriveQueue();
  for (const f of driveFiles) queue.push({ file: f });

  for (const item of queue) {
    if (item.scheduled) continue;
    const local = await download(item.file);

    // quick safety scan
    try {
      const buf = fs.readFileSync(local);
      const cls = await classifyFrame(buf);
      if (!cls.safe) await redactRegions(local, cls.regions || []);
    } catch {}

    const edited = await applyCapCutTemplate(local);

    const when = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    if (!dryrun) await schedule({ fileUrl: edited, caption: '', whenISO: when });
    item.scheduled = when;
    console.log('[orchestrate] scheduled', item.file, 'at', when);

    // clean up temporary file
    if (!dryrun) {
      try { fs.unlinkSync(local); } catch {}
    }
  }

  if (!dryrun) {
    fs.mkdirSync(path.dirname(queuePath), { recursive: true });
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  }
}

main();
