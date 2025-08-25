import { readFile } from 'fs/promises';
import path from 'path';
import { getConfig } from '../utils/config';

/**
 * Gather configuration needed for soul-reading and Stripe features.
 * Combines remote config values with local stripe product mappings.
 */
export async function getSoulConfig(): Promise<Record<string, unknown>> {
  const [stripeCfg, soulCfg] = await Promise.all([
    getConfig('stripe').catch(() => ({})),
    getConfig('soul').catch(() => ({})),
  ]);

  let products: Record<string, unknown> = {};
  try {
    const file = path.resolve('config/stripe-products.json');
    const raw = await readFile(file, 'utf8');
    products = JSON.parse(raw);
  } catch {
    console.warn('[getSoulConfig] failed to load stripe-products.json');
  }

  return {
    stripe: { ...stripeCfg, products },
    soul: soulCfg,
  };
}
