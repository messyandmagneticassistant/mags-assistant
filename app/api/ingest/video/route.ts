import { NextRequest, NextResponse } from 'next/server';
import { getDrive } from '../../../../lib/google';

export async function POST(req: NextRequest) {
  try {
    const { fileId } = await req.json();
    if (!fileId) {
      return NextResponse.json({ ok: false, error: 'fileId required' }, { status: 400 });
    }
    const drive = await getDrive();
    const date = new Date().toISOString().slice(0, 10);
    const parent = '1ebD1-EvQgOIV5ip9w9eSejBtYjpRPBd6';
    // ensure /Inbox folder
    const inboxRes = await drive.files.list({
      q: `name='Inbox' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
    });
    let inboxId = inboxRes.data.files?.[0]?.id;
    if (!inboxId) {
      const r = await drive.files.create({
        requestBody: { name: 'Inbox', mimeType: 'application/vnd.google-apps.folder', parents: [parent] },
        fields: 'id',
      });
      inboxId = r.data.id!;
    }
    const folderRes = await drive.files.create({
      requestBody: {
        name: date,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [inboxId],
      },
      fields: 'id',
    });
    const folderId = folderRes.data.id!;
    await drive.files.copy({ fileId, requestBody: { parents: [folderId] } });
    return NextResponse.json({ ok: true, copiedTo: folderId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
