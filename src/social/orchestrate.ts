import fs from 'fs';
import path from 'path';
import { schedule } from './scheduler';
import { ensureSafe } from '../media/pipeline';
import { tgSend } from '../../lib/telegram';

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

  const env = {
    BRAIN: {
      store: new Map<string, string>(),
      async get(key: string) {
        return this.store.get(key) || null;
      },
      async put(key: string, val: string) {
        this.store.set(key, val);
      },
      async delete(key: string) {
        this.store.delete(key);
      },
    },
  } as any;

  for (const item of queue) {
    if (item.scheduled) continue;
    let local = await download(item.file);

    const report = await ensureSafe(env, { id: path.basename(local), path: local, caption: item.caption || '' });
    item.safetyReportId = report.id;
    console.log(`[orchestrate] Safety: ${report.status}`);

    if (report.status === 'rejected') {
      const link = `${process.env.WORKER_URL || ''}/admin/media/report?id=${report.id}`;
      const msg = `❌ Rejected: ${report.reasons.join(',')}`;
      console.log('[orchestrate]', msg);
      await tgSend(`${msg}\n${link}`);
      continue;
    }

    if (report.status === 'fixed') {
      if (report.artifactPath) local = report.artifactPath;
      item.caption = report.captionOut;
      await tgSend(`auto-fixed ${item.file}`);
    } else {
      item.caption = report.captionOut;
    }

    const edited = await applyCapCutTemplate(local);

    const when = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    if (!dryrun) await schedule({ fileUrl: edited, caption: item.caption || '', whenISO: when });
    item.scheduled = when;
    console.log('[orchestrate] scheduled', item.file, 'at', when);

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
