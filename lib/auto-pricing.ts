/**
 * Auto pricing utilities following the guardrails in the product brief.
 *
 * The algorithm performs the following steps:
 * 1. Build a comparable basket and compute median and quartiles.
 * 2. Start from max(median, lowerQuartile) and apply positional nudges.
 * 3. Clamp to baseline guardrails and round to friendly endings.
 * 4. Adjust for historical conversion/refund signals.
 * 5. Emit a human readable note and status flag for review if needed.
 */

export interface PricingInput {
  comps: number[]; // Comparable market prices
  guardrail: { min: number; max: number };
  followUpCall?: boolean; // +15-25%
  customVisuals?: boolean; // +5-10%
  history?: {
    conversionRate?: number; // prior CVR for similar offer
    avgOrderUp?: boolean; // whether AOV increased with price
    refundRate?: number; // prior refund rate
    lastLivePrice?: number; // last published price
  };
}

export interface PricingResult {
  price: number;
  note: string;
  status: 'OK' | 'Needs Review';
}

// Baseline guardrails (USD)
export const BASE_GUARDRAILS = {
  donation: { min: 5, max: 250 },
  soulMini: { min: 19, max: 59 },
  soulFull: { min: 59, max: 149 },
  fullPlusCall: { min: 99, max: 229 },
  bundleStarter: { min: 39, max: 89 },
  bundleDeepDive: { min: 99, max: 199 },
  giftCard: { min: 25, max: 200 },
} as const;

const FRIENDLY_ENDINGS = [
  19, 29, 39, 49, 59, 69, 79, 89, 99, 119, 149, 199,
];

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function quartiles(nums: number[]): { q1: number; q3: number } {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted.slice(0, mid);
  const upper = sorted.length % 2 === 0 ? sorted.slice(mid) : sorted.slice(mid + 1);
  return { q1: median(lower), q3: median(upper) };
}

function clamp(num: number, min: number, max: number) {
  return Math.min(Math.max(num, min), max);
}

function roundFriendly(num: number) {
  // Find friendly value closest to num
  let best = FRIENDLY_ENDINGS[0];
  let diff = Math.abs(num - best);
  for (const f of FRIENDLY_ENDINGS) {
    const d = Math.abs(num - f);
    if (d < diff) {
      best = f;
      diff = d;
    }
  }
  return best;
}

function stepDown(price: number): number {
  // Pick next lower friendly ending
  const sorted = [...FRIENDLY_ENDINGS].sort((a, b) => a - b);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (price > sorted[i]) return sorted[i];
  }
  return sorted[0];
}

export function autoPrice(input: PricingInput): PricingResult {
  if (!input.comps || input.comps.length < 1) {
    throw new Error('At least one comparable price required');
  }
  // 1. baseline from comps
  const med = median(input.comps);
  const { q1 } = quartiles(input.comps);
  let price = Math.max(med, q1);

  // 2. positional nudges
  if (input.followUpCall) price *= 1.2; // default +20%
  if (input.customVisuals) price *= 1.07; // default +7%

  // 3. guardrails and rounding
  price = clamp(price, input.guardrail.min, input.guardrail.max);
  price = roundFriendly(price);

  // 4. sanity check against history
  const history = input.history || {};
  if (history.conversionRate && history.conversionRate >= 0.04 && history.avgOrderUp) {
    price = roundFriendly(clamp(price * 1.1, input.guardrail.min, input.guardrail.max));
  }
  if (
    (history.refundRate && history.refundRate > 0.03) ||
    (history.conversionRate && history.conversionRate < 0.015)
  ) {
    price = stepDown(price);
  }

  // 5. note and human check
  const last = history.lastLivePrice ?? price;
  const deviation = Math.abs(price - last) / last;
  const status = deviation > 0.3 ? 'Needs Review' : 'OK';
  const note = `med=${med.toFixed(2)} q1=${q1.toFixed(2)} -> ${price}`;

  return { price, note, status };
}

