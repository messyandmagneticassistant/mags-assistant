import Stripe from 'stripe';

export interface MetadataCheckResult {
  id: string;
  missing: string[];
}

const REQUIRED_BOOLEAN_KEYS = [
  'price_per_person',
  'includes_physical',
  'child_friendly_version',
] as const;

const TIER_VALUES = ['mini', 'lite', 'full', 'realignment', 'addon'];

export async function validateMetadata(stripe: Stripe) {
  const res = await stripe.products.list({ limit: 100 });
  const failures: MetadataCheckResult[] = [];
  for (const prod of res.data) {
    const meta = prod.metadata || {};
    const missing: string[] = [];

    if (!meta.tier || !TIER_VALUES.includes(meta.tier)) {
      missing.push('tier');
    }
    for (const key of REQUIRED_BOOLEAN_KEYS) {
      if (!(key in meta)) missing.push(key);
      else if (!['true', 'false'].includes(String(meta[key]))) missing.push(key);
    }
    if ('max_people' in meta && isNaN(Number(meta.max_people))) {
      missing.push('max_people');
    }
    if (missing.length) {
      console.warn(`Product ${prod.id} missing metadata: ${missing.join(', ')}`);
      failures.push({ id: prod.id, missing });
    }
  }
  if (failures.length) {
    console.log('Products needing metadata fixes:', failures.map((f) => f.id));
  }
  return failures.map((f) => f.id);
}

export default validateMetadata;
