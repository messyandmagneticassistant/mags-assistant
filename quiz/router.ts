import { DEFAULT_PRODUCTS, type ProductDef } from '../config/products';
import { adjustForMagnetKit, type MagnetOption } from '../lib/pricing/dynamicPricing';

export interface QuizRoutingInput {
  household?: string;
  format?: string;
  tier?: string;
}

export interface QuizRoutingResult {
  product: ProductDef;
  recommendedMagnet: MagnetOption;
  household: string;
  tierKey: ProductDef['key'];
}

const TIER_KEY_MAP: Record<string, ProductDef['key']> = {
  basic: 'intro',
  intro: 'intro',
  mini: 'intro',
  lite: 'intro',
  full: 'full',
  premium: 'full',
  deep: 'full',
  family: 'family',
  household: 'family',
};

function normalize(value?: string) {
  return (value || '').trim().toLowerCase();
}

function resolveTierKey(input: QuizRoutingInput): ProductDef['key'] {
  const tier = normalize(input.tier);
  const household = normalize(input.household);

  if (TIER_KEY_MAP[tier]) return TIER_KEY_MAP[tier];
  if (household.includes('family') || household.includes('household')) return 'family';
  if (tier.includes('full') || tier.includes('premium')) return 'full';
  return 'intro';
}

function resolveMagnet(format?: string): MagnetOption {
  const normalized = normalize(format);
  if (normalized.includes('print')) return 'printable';
  if (normalized.includes('vinyl') || normalized.includes('whiteboard')) return 'whiteboard vinyl';
  if (normalized.includes('cling')) return 'cling';
  return 'digital';
}

function pickProduct(key: ProductDef['key']): ProductDef {
  const product = DEFAULT_PRODUCTS.find((item) => item.key === key);
  if (!product) {
    throw new Error(`Unsupported product tier key: ${key}`);
  }
  return product;
}

/**
 * Given quiz metadata, choose the product tier and magnet option Maggie should fulfill.
 * This keeps all funnel routing decisions in one place so the worker/Next.js handlers
 * can simply call into this helper.
 */
export function routeQuizSubmission(input: QuizRoutingInput): QuizRoutingResult {
  const tierKey = resolveTierKey(input);
  const product = pickProduct(tierKey);
  const recommendedMagnet = resolveMagnet(input.format);

  // Touch the magnet pricing helper to ensure option is valid/covered by automation.
  void adjustForMagnetKit(recommendedMagnet);

  return {
    product,
    recommendedMagnet,
    household: input.household || 'Solo',
    tierKey,
  };
}
