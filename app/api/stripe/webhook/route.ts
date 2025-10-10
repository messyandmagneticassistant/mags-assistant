import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { Client } from '@notionhq/client';
import fs from 'fs/promises';
import { getConfig } from '../../../utils/config';
import { ensureTelegramWebhook } from './telegramFallback';
import { logErrorToSheet } from '../../../../lib/maggieLogs';
import { updateWebhookStatus } from '../../../../lib/statusStore';
import { tgSend } from '../../../../lib/telegram';
import { parseReadingFromSession, ReadingPayload } from '../../../../lib/stripe/parseReadingFromSession';
import { triggerReading } from '../../../../lib/stripe/reading';

export const runtime = 'nodejs';

const VALID_READING_TIERS = ['full', 'lite', 'mini'] as const;
type ReadingTier = (typeof VALID_READING_TIERS)[number];

function normalizeTier(payload: ReadingPayload): ReadingTier {
  const rawTier = payload.metadata?.tier;
  const stringTier =
    typeof rawTier === 'string'
      ? rawTier
      : rawTier === null || rawTier === undefined
      ? ''
      : String(rawTier);
  const normalized = stringTier.trim().toLowerCase();

  if (!VALID_READING_TIERS.includes(normalized as ReadingTier)) {
    throw new Error(
      `Unsupported soul reading tier for session ${payload.sessionId || 'unknown'}: ${stringTier}`
    );
  }

  return normalized as ReadingTier;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return undefined;
}

function extractBoolean(value: unknown): boolean {
  const parsed = parseBoolean(value);
  return parsed !== undefined ? parsed : false;
}

function extractOptionalBoolean(value: unknown): boolean | undefined {
  return parseBoolean(value);
}

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

  if (process.env.NODE_ENV !== 'production') {
    console.info('[StripeWebhook] Incoming request', {
      signature: sig,
      payload,
    });
  }
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

    if (event.type === 'checkout.session.completed') {
      const session = obj as Stripe.Checkout.Session;
      if (!session.id) {
        throw new Error('Stripe session missing id');
      }

      const [fullSession, lineItems] = await Promise.all([
        stripe.checkout.sessions.retrieve(session.id, {
          expand: ['customer', 'customer_details'],
        }),
        stripe.checkout.sessions.listLineItems(session.id, {
          expand: ['data.price.product'],
        }),
      ]);

      const readingPayloads: ReadingPayload[] = parseReadingFromSession(fullSession, lineItems.data);

      if (!readingPayloads.length) {
        throw new Error(`No line items available for Stripe session ${session.id}`);
      }

      await Promise.all(
        readingPayloads.map(async (payload) => {
          const normalizedTier = normalizeTier(payload);
          const isAddon = extractBoolean(payload.metadata?.is_addon);
          const childFriendly = extractOptionalBoolean(payload.metadata?.child_friendly);

          await triggerReading({
            email: payload.email,
            metadata: {
              tier: normalizedTier,
              is_addon: isAddon,
              child_friendly: childFriendly,
            },
            sessionId: payload.sessionId,
            purchasedAt: payload.purchasedAt,
          });
        })
      );

      if (process.env.NODE_ENV !== 'production') {
        const tiers = readingPayloads
          .map((payload) => {
            try {
              return normalizeTier(payload);
            } catch {
              return null;
            }
          })
          .filter((tier): tier is string => Boolean(tier));

        console.info('[StripeWebhook] Soul reading automation dispatched', {
          payloadCount: readingPayloads.length,
          tiers,
          email:
            readingPayloads[0]?.email ||
            fullSession.customer_details?.email ||
            (typeof fullSession.customer_email === 'string' ? fullSession.customer_email : ''),
        });
      }
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
    return new NextResponse('failed to process webhook', { status: 400 });
  }
}
