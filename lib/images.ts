import { google } from 'googleapis';
import { env } from './env.js';
import { getStripe } from './clients/stripe.js';
import { getOpenAI } from './clients/openai';
import { fetchGoogleKey } from './google-key.js';

async function getDrive() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    undefined,
    (await fetchGoogleKey()).replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/drive.readonly']
  );
  return google.drive({ version: 'v3', auth });
}

export async function driveDownloadFirstImage(folderId: string) {
  const drive = await getDrive();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and mimeType contains 'image/'`,
    pageSize: 10,
    fields: 'files(id,name,mimeType)',
  });
  const file = res.data.files?.[0];
  if (!file) return null;
  const data = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(data.data as ArrayBuffer);
}

export async function findImageForProduct({
  name,
  imageFolder,
  stripeProductId,
}: {
  name: string;
  imageFolder?: string;
  stripeProductId?: string;
}) {
  if (imageFolder && env.DRIVE_PRODUCT_IMAGES_ROOT_ID) {
    let folderId = imageFolder;
    const match = imageFolder.match(/[-\w]{25,}/);
    if (match) folderId = match[0];
    if (!match) {
      try {
        const drive = await getDrive();
        const search = await drive.files.list({
          q: `name='${imageFolder}' and '${env.DRIVE_PRODUCT_IMAGES_ROOT_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: 'files(id)',
          pageSize: 1,
        });
        folderId = search.data.files?.[0]?.id || folderId;
      } catch {}
    }
    const buf = await driveDownloadFirstImage(folderId);
    if (buf) return buf;
  }
  if (stripeProductId) {
    try {
      const stripe = await getStripe();
      const prod = await stripe.products.retrieve(stripeProductId);
      const url = prod.images?.[0];
      if (url) {
        const res = await fetch(url);
        const arr = await res.arrayBuffer();
        return Buffer.from(arr);
      }
    } catch {}
  }
  if (process.env.OPENAI_API_KEY) {
    try {
      const openai = getOpenAI();
      const prompt = `${process.env.DALL_E_STYLE_PROMPT || ''} ${name}`.trim();
      const img = await openai.images.generate({ model: 'dall-e-3', prompt, n: 1, size: '512x512' });
      const url = img.data[0]?.url;
      if (url) {
        const res = await fetch(url);
        const arr = await res.arrayBuffer();
        return Buffer.from(arr);
      }
    } catch {}
  }
  return null;
}
