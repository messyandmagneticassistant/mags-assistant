import Stripe from 'stripe';
import { loadSkuMap, validateEmail, splitName, loadFulfillmentConfig } from './common';
import type { NormalizedIntake, CustomerProfile, FulfillmentTier } from './types';
import { sendEmail } from '../../utils/email';

type StripeSession = Stripe.Checkout.Session & {
  line_items?: Stripe.ApiList<Stripe.LineItem>;
};

interface MissingFieldNotice {
  email?: string;
  missing: string[];
  source: 'stripe' | 'tally';
}

function normalizeTier(input?: string | null): FulfillmentTier | undefined {
  if (!input) return undefined;
  const value = input.toLowerCase();
  if (value.includes('mini')) return 'mini';
  if (value.includes('lite')) return 'lite';
  if (value.includes('full')) return 'full';
  return undefined;
}

async function requestMissingInfo(intake: MissingFieldNotice, configEmail?: { fromEmail?: string; fromName?: string }) {
  if (!intake.email || !validateEmail(intake.email)) return;
  const subject = 'Quick follow-up so we can finish your kit';
  const body = `Hi there,\n\nThanks for your order! We just need a little more information to complete your ${
    intake.source === 'stripe' ? 'reading bundle' : 'reading'}
  . Could you share the following details?\n\n- ${intake.missing.join('\n- ')}\n\nYou can reply to this email or fill out the intake form here: ${
    process.env.FULFILLMENT_INTAKE_FALLBACK_URL || 'https://messyandmagnetic.com/forms/intake'
  }.\n\nWith love,\nMaggie`;
  try {
    await sendEmail(
      {
        to: intake.email,
        subject,
        text: body,
        html: body.replace(/\n/g, '<br />'),
      },
      {
        RESEND_FROM_EMAIL: configEmail?.fromEmail,
        RESEND_FROM_NAME: configEmail?.fromName,
      }
    );
  } catch (err) {
    console.warn('[fulfillment.intake] unable to send missing info email:', err);
  }
}

function mergeCustomer(base: CustomerProfile, update: Partial<CustomerProfile>): CustomerProfile {
  return {
    ...base,
    ...update,
    birth: {
      ...(base.birth || {}),
      ...(update.birth || {}),
    },
  };
}

function extractBirthFromMetadata(metadata: Stripe.Metadata | null | undefined): CustomerProfile['birth'] {
  if (!metadata) return {};
  const birth: CustomerProfile['birth'] = {};
  const date = metadata['birthdate'] || metadata['birth_date'] || metadata['dob'];
  if (typeof date === 'string') birth.date = date.trim();
  const time = metadata['birthtime'] || metadata['birth_time'];
  if (typeof time === 'string') birth.time = time.trim();
  const location = metadata['birthplace'] || metadata['birth_place'] || metadata['birthlocation'];
  if (typeof location === 'string') birth.location = location.trim();
  const tz = metadata['timezone'] || metadata['birth_timezone'];
  if (typeof tz === 'string') birth.timezone = tz.trim();
  return birth;
}

function buildCustomerProfile(session: StripeSession): CustomerProfile {
  const details = session.customer_details || {};
  const metadata = session.metadata || {};
  const profile: CustomerProfile = {};

  const name = metadata['name'] || metadata['full_name'] || details.name || '';
  if (name) {
    profile.name = name;
    const parts = splitName(name);
    profile.firstName = metadata['first_name'] || parts.firstName;
    profile.lastName = metadata['last_name'] || parts.lastName;
  } else {
    profile.firstName = metadata['first_name'] || details.name || undefined;
    profile.lastName = metadata['last_name'] || undefined;
  }
  if (!profile.name && (profile.firstName || profile.lastName)) {
    profile.name = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  }

  const birth = extractBirthFromMetadata(metadata);
  if (Object.keys(birth || {}).length) {
    profile.birth = birth;
  }
  const pronouns = metadata['pronouns'];
  if (pronouns && typeof pronouns === 'string') profile.pronouns = pronouns;
  const partner = metadata['partner_name'] || metadata['partner'];
  if (partner && typeof partner === 'string') profile.partnerName = partner;

  return profile;
}

function deriveTierFromLineItems(lineItems: Stripe.LineItem[], skuMap: Record<string, { tier?: string; addOns?: string[] }>) {
  let tier: FulfillmentTier | undefined;
  const addOns = new Set<string>();
  for (const item of lineItems) {
    const priceId = item.price?.id;
    if (!priceId) continue;
    const mapping = skuMap[priceId];
    if (!mapping) continue;
    if (!tier && mapping.tier) tier = normalizeTier(mapping.tier) || tier;
    for (const addOn of mapping.addOns || []) addOns.add(addOn);
  }
  return { tier, addOns: Array.from(addOns) };
}

function buildPrefsFromMetadata(metadata: Stripe.Metadata | null | undefined): Record<string, any> {
  const prefs: Record<string, any> = {};
  if (!metadata) return prefs;
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null || value === '') continue;
    const normalizedKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    prefs[normalizedKey] = value;
  }
  return prefs;
}

async function loadStripeClient(stripe?: Stripe): Promise<Stripe> {
  if (stripe) return stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Missing STRIPE_SECRET_KEY for Stripe intake normalization');
  return new Stripe(key, { apiVersion: '2023-10-16' });
}

export async function normalizeFromStripe(
  sessionId: string,
  opts: { stripe?: Stripe; env?: any } = {}
): Promise<NormalizedIntake> {
  const skuMap = await loadSkuMap();
  let config: Awaited<ReturnType<typeof loadFulfillmentConfig>> | null = null;
  try {
    config = await loadFulfillmentConfig(opts);
  } catch (err) {
    console.warn('[fulfillment.intake] continuing without full config:', err);
  }
  const stripe = await loadStripeClient(opts.stripe);
  const session = (await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items.data.price.product'],
  })) as StripeSession;

  const lineItems = session.line_items?.data || [];
  const { tier: mappedTier, addOns } = deriveTierFromLineItems(lineItems, skuMap);

  const metadataTier = normalizeTier((session.metadata?.tier as string) || session.metadata?.package || '');
  const tier = mappedTier || metadataTier;

  const email = session.customer_details?.email || session.customer_email || session.metadata?.email || '';
  const prefs = buildPrefsFromMetadata(session.metadata);
  if (session.customer_details?.phone) prefs.phone = session.customer_details.phone;
  if (session.customer_details?.address) prefs.address = session.customer_details.address;

  const customer = buildCustomerProfile(session);
  const normalized: NormalizedIntake = {
    source: 'stripe',
    email,
    tier: tier || 'lite',
    addOns,
    prefs,
    customer,
    referenceId: session.id,
    raw: session,
  };

  const missing: string[] = [];
  if (!validateEmail(email)) missing.push('email');
  if (!tier) missing.push('preferred tier');
  if (!customer?.birth?.date) missing.push('birth date');

  if (missing.length && config) {
    await requestMissingInfo(
      { email, missing, source: 'stripe' },
      {
        fromEmail: config.resendFromEmail,
        fromName: config.resendFromName,
      }
    );
  }

  return normalized;
}

function parseTallyBirth(data: Record<string, any>): CustomerProfile['birth'] {
  const birth: CustomerProfile['birth'] = {};
  const date = data.birthdate || data.birth_date || data.dob;
  if (typeof date === 'string') birth.date = date.trim();
  const time = data.birthtime || data.birth_time;
  if (typeof time === 'string') birth.time = time.trim();
  const location = data.birthplace || data.birth_place || data.location;
  if (typeof location === 'string') birth.location = location.trim();
  const tz = data.birth_timezone || data.timezone;
  if (typeof tz === 'string') birth.timezone = tz.trim();
  return birth;
}

function parseHousehold(data: Record<string, any>): string[] | undefined {
  const raw = data.household || data.children || data.family_members;
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  if (typeof raw === 'string') {
    return raw
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return undefined;
}

export async function normalizeFromTally(
  payload: any,
  opts: { env?: any } = {}
): Promise<NormalizedIntake> {
  const skuMap = await loadSkuMap();
  let config: Awaited<ReturnType<typeof loadFulfillmentConfig>> | null = null;
  try {
    config = await loadFulfillmentConfig(opts);
  } catch (err) {
    console.warn('[fulfillment.intake] continuing without full config:', err);
  }
  const data: Record<string, any> = payload?.data || payload || {};
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  const tierFromField = normalizeTier(data.tier || data.package || data.selection);
  const productId = data.productId || data.product_id || data.price_id;
  const mapping = productId ? skuMap[String(productId)] : undefined;
  const tier = tierFromField || normalizeTier(mapping?.tier || '');
  const addOns = new Set<string>();
  for (const addOn of mapping?.addOns || []) addOns.add(addOn);
  const schedulePrefs = parseHousehold(data);

  const name = data.name || `${data.first_name || ''} ${data.last_name || ''}`.trim();
  const customer: CustomerProfile = {
    name: name || undefined,
    firstName: data.first_name || undefined,
    lastName: data.last_name || undefined,
    pronouns: data.pronouns || undefined,
    birth: parseTallyBirth(data),
    partnerName: data.partner || data.partner_name || undefined,
    householdMembers: schedulePrefs,
  };

  const prefs: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || key === 'email') continue;
    prefs[key] = value;
  }

  const normalized: NormalizedIntake = {
    source: 'tally',
    email,
    tier: tier || 'lite',
    addOns: Array.from(addOns),
    prefs,
    customer,
    referenceId: payload?.submissionId || payload?.eventId,
    schedulePreferences: schedulePrefs,
    raw: payload,
  };

  const missing: string[] = [];
  if (!validateEmail(email)) missing.push('email');
  if (!tier) missing.push('preferred tier');
  if (!customer?.birth?.date) missing.push('birth date');

  if (missing.length && config) {
    await requestMissingInfo(
      { email, missing, source: 'tally' },
      {
        fromEmail: config.resendFromEmail,
        fromName: config.resendFromName,
      }
    );
  }

  return normalized;
}

export function mergeIntake(base: NormalizedIntake, update: Partial<NormalizedIntake>): NormalizedIntake {
  return {
    ...base,
    ...update,
    addOns: Array.from(new Set([...(base.addOns || []), ...(update.addOns || [])])).filter(Boolean),
    prefs: { ...base.prefs, ...(update.prefs || {}) },
    customer: mergeCustomer(base.customer || {}, update.customer || {}),
  };
}
