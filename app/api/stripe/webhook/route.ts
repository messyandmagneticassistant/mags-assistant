import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { Client } from '@notionhq/client';
import fs from 'fs/promises';
import { getConfig } from '../../../utils/config';
import { ensureTelegramWebhook } from './telegramFallback';
import { logErrorToSheet } from '../../../../lib/maggieLogs';
import { updateWebhookStatus } from '../../../../lib/statusStore';
import { tgSend } from '../../../../lib/telegram';

export const runtime = 'nodejs';

async function getDonorDbId(notion: Client, notionCfg: any): Promise<string> {
  const envId = process.env.DONORS_DATABASE_ID;
  if (envId) return envId;
  try {
    const data = JSON.parse(await fs.readFile('.runtime/notion.json', 'utf8'));
    if (data.DONORS_DATABASE_ID) return data.DONORS_DATABASE_ID;
  } catch {}
  const parent = notionCfg.hqPageId;
  if (!parent) throw new Error('missing NOTION_HQ_PAGE_ID');
  const res = await notion.databases.create({
    parent: { page_id: parent },
    title: [{ type: 'text', text: { content: 'Donors' } }],
    properties: {
      Donor: { title: {} },
      Email: { email: {} },
      Amount: { number: {} },
      Currency: { select: { options: [] } },
      StripeID: { rich_text: {} },
      Date: { date: {} },
      'Message/Note': { rich_text: {} }
    }
  });
  await fs.mkdir('.runtime', { recursive: true });
  await fs.writeFile('.runtime/notion.json', JSON.stringify({ DONORS_DATABASE_ID: res.id }));
  return res.id;
}

async function upsertDonor(
  notion: Client,
  dbId: string,
  data: { name: string; email: string; amount: number; currency: string; stripeId: string; message?: string; date: number }
) {
  const { name, email, amount, currency, stripeId, message, date } = data;
  const q = await notion.databases.query({
    database_id: dbId,
    filter: { property: 'StripeID', rich_text: { equals: stripeId } }
  });
  const props: any = {
    Donor: { title: [{ text: { content: name || 'Anonymous' } }] },
    Email: { email: email || '' },
    Amount: { number: amount },
    Currency: { select: { name: currency.toUpperCase() } },
    StripeID: { rich_text: [{ text: { content: stripeId } }] },
    Date: { date: { start: new Date(date).toISOString() } },
    'Message/Note': { rich_text: message ? [{ text: { content: message } }] : [] }
  };
  if (q.results[0]) {
    await notion.pages.update({ page_id: q.results[0].id, properties: props });
  } else {
    await notion.pages.create({ parent: { database_id: dbId }, properties: props });
  }
}

export async function POST(req: NextRequest) {
  const startedAt = new Date().toISOString();
  const stripeCfg = await getConfig('stripe');
  const notionCfg = await getConfig('notion');
  const missing = [] as string[];
  if (!stripeCfg.webhookSecret) missing.push('STRIPE_WEBHOOK_SECRET');
  if (!stripeCfg.secretKey) missing.push('STRIPE_SECRET_KEY');
  if (!notionCfg.token) missing.push('NOTION_TOKEN');
  if (missing.length) {
    return NextResponse.json({ ok: false, missing });
  }
  const secret = stripeCfg.webhookSecret as string;
  const stripeKey = stripeCfg.secretKey as string;
  const notionToken = notionCfg.token as string;
  const payload = await req.text();
  const sig = req.headers.get('stripe-signature') || '';

  console.info('[StripeWebhook] Incoming request', {
    signature: sig,
    payload,
  });
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
  let event: Stripe.Event | null = null;
  const recoverySteps: string[] = [];

  try {
    event = stripe.webhooks.constructEvent(payload, sig, secret);
  } catch (err) {
    try {
      const parsed = JSON.parse(payload || '{}');
      if (parsed?.id) {
        event = await stripe.events.retrieve(parsed.id);
        recoverySteps.push('construct-failed');
        recoverySteps.push('retrieved-event');
      }
    } catch {}
    if (!event) {
      const errorMessage = err instanceof Error ? err.message : 'invalid signature';
      await Promise.all([
        logErrorToSheet({
          module: 'StripeWebhook',
          error: errorMessage,
          recovery: 'constructEvent',
          timestamp: startedAt,
        }),
        updateWebhookStatus('stripe', {
          lastFailureAt: startedAt,
          error: errorMessage,
        }),
        tgSend(`⚠️ Stripe webhook signature failed at ${startedAt}: ${errorMessage}`).catch(() => undefined),
      ]);
      return new NextResponse('invalid signature', { status: 400 });
    }
  }

  try {
    const notion = new Client({ auth: notionToken });
    const dbId = await getDonorDbId(notion, notionCfg);
    const obj: any = event.data.object;
    if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
      const amount = (obj.amount_total || obj.amount_received || obj.amount || 0) / 100;
      const currency = (obj.currency || 'usd') as string;
      const name = obj.customer_details?.name || obj.shipping?.name || '';
      const email = obj.customer_details?.email || obj.receipt_email || '';
      const stripeId = obj.id || obj.payment_intent || '';
      const message = obj.metadata?.message || obj.metadata?.note;
      const date = (obj.created || Math.floor(Date.now() / 1000)) * 1000;
      await upsertDonor(notion, dbId, { name, email, amount, currency, stripeId, message, date });
      await ensureTelegramWebhook({ id: stripeId, email });
    }
    await updateWebhookStatus('stripe', {
      lastSuccessAt: new Date().toISOString(),
      error: null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    recoverySteps.push('process-failed');
    await Promise.all([
      logErrorToSheet({
        module: 'StripeWebhook',
        error: errorMessage,
        recovery: recoverySteps.join(' → ') || undefined,
        timestamp: startedAt,
      }),
      updateWebhookStatus('stripe', {
        lastFailureAt: startedAt,
        error: errorMessage,
      }),
      tgSend(`⚠️ Stripe webhook error at ${startedAt}: ${errorMessage}`).catch(() => undefined),
    ]);
    return new NextResponse('internal error', { status: 500 });
  }
}
