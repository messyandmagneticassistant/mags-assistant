import { describe, it, expect, vi } from 'vitest';
import validateMetadata from './validateMetadata';

describe('validateMetadata', () => {
  it('Validate 100 Stripe products and log 3 with missing metadata', async () => {
    const products = [] as any[];
    for (let i = 0; i < 100; i++) {
      const base = {
        id: `prod_${i}`,
        metadata: {
          tier: 'mini',
          price_per_person: 'true',
          includes_physical: 'false',
          child_friendly_version: 'false',
        },
      };
      if (i === 0) base.metadata.tier = 'bad';
      if (i === 1) base.metadata.price_per_person = 'maybe';
      if (i === 2) delete base.metadata.includes_physical;
      products.push(base);
    }
    const stripe = {
      products: { list: vi.fn().mockResolvedValue({ data: products }) },
    } as any;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await validateMetadata(stripe);
    expect(res).toEqual(['prod_0', 'prod_1', 'prod_2']);
    warn.mockRestore();
    log.mockRestore();
  });
});
