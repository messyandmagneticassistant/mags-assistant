import fs from 'fs/promises';
import { getConfig } from '../../../utils/config';

export const runtime = 'nodejs';

async function readDonorDbId() {
  if (process.env.DONORS_DATABASE_ID) return process.env.DONORS_DATABASE_ID;
  try {
    const data = JSON.parse(await fs.readFile('.runtime/notion.json', 'utf8'));
    return data.DONORS_DATABASE_ID || null;
  } catch {
    return null;
  }
}

export async function GET() {
  const stripe = await getConfig('stripe');
  const hasSecret = Boolean(stripe.webhookSecret);
  const dbId = await readDonorDbId();
  return Response.json({ ok: true, webhookConfigured: hasSecret && !!dbId });
}
