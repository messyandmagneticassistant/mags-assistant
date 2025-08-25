import { NextRequest, NextResponse } from 'next/server';
import { getDrive } from '../../../../lib/google';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const WATCH_FILE = path.join(process.cwd(), 'data', 'watchers.json');
const FOLDER_ID = '1ebD1-EvQgOIV5ip9w9eSejBtYjpRPBd6';

async function readStatus() {
  try {
    const txt = await fs.readFile(WATCH_FILE, 'utf8');
    return JSON.parse(txt);
  } catch {
    return {};
  }
}

async function writeStatus(data: any) {
  await fs.mkdir(path.dirname(WATCH_FILE), { recursive: true });
  await fs.writeFile(WATCH_FILE, JSON.stringify(data, null, 2));
}

export async function GET() {
  const watchers = await readStatus();
  return NextResponse.json({ ok: true, watchers });
}

export async function POST(req: NextRequest) {
  try {
    const drive = await getDrive();
    const channelId = randomUUID();
    const domain = process.env.PROD_DOMAIN || req.headers.get('host') || '';
    const address = `https://${domain}/api/drive/notify`;
    const res = await drive.files.watch({
      fileId: FOLDER_ID,
      requestBody: { id: channelId, type: 'web_hook', address },
    });
    const watchers = await readStatus();
    watchers[FOLDER_ID] = {
      channelId,
      resourceId: res.data.resourceId,
      expiration: res.data.expiration,
    };
    await writeStatus(watchers);
    return NextResponse.json({ ok: true, channelId, resourceId: res.data.resourceId, expiration: res.data.expiration });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
