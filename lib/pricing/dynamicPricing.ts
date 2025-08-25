export type Tier = 'mini' | 'lite' | 'full' | 'realignment';

const BASE_PRICES: Record<Tier, number> = {
  mini: 44,
  lite: 88,
  full: 144,
  realignment: 77,
};

export function getBasePrice(tier: Tier): number {
  return BASE_PRICES[tier];
}

export function adjustForFamily(count: number, tier: Tier): number {
  const base = getBasePrice(tier);
  const people = Math.min(Math.max(count, 1), 5);
  if (people === 1) return base;
  const additional = people - 1;
  return base + base * 0.8 * additional;
}

export type ChartSystem = 'Enneagram' | 'MBTI' | 'Kabbalah' | 'Vedic' | 'Mayan' | 'Galactic';

const SYSTEM_PRICES: Record<ChartSystem, number> = {
  Enneagram: 7,
  MBTI: 7,
  Kabbalah: 7,
  Vedic: 9,
  Mayan: 9,
  Galactic: 9,
};

export function addChartSystem(system: ChartSystem): number {
  return SYSTEM_PRICES[system] || 0;
}

export type MagnetOption =
  | 'digital'
  | 'printable'
  | 'cling'
  | 'whiteboard vinyl'
  | 'premade magnet kit';

const MAGNET_PRICES: Record<MagnetOption, number> = {
  digital: 0,
  printable: 7,
  cling: 11,
  'whiteboard vinyl': 17,
  'premade magnet kit': 33,
};

export function adjustForMagnetKit(option: MagnetOption): number {
  return MAGNET_PRICES[option] || 0;
}

export interface QuoteOptions {
  tier: Tier;
  personCount: number;
  addons?: ChartSystem[];
  magnetType?: MagnetOption;
}

export interface QuoteBreakdown {
  base: number;
  family: number;
  systems: Record<string, number>;
  magnet: number;
  total: number;
}

export function quotePrice(opts: QuoteOptions): QuoteBreakdown {
  const count = Math.max(opts.personCount, 1);
  const base = getBasePrice(opts.tier);
  const familyTotal = adjustForFamily(count, opts.tier);
  const family = familyTotal - base;
  const systems: Record<string, number> = {};
  let systemsTotal = 0;
  for (const addon of opts.addons || []) {
    const price = addChartSystem(addon) * Math.min(count, 5);
    systems[addon] = price;
    systemsTotal += price;
  }
  const magnet = adjustForMagnetKit(opts.magnetType || 'digital');
  const total = familyTotal + systemsTotal + magnet;
  return { base, family, systems, magnet, total };
}
