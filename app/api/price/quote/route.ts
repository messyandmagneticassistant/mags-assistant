import { NextRequest, NextResponse } from 'next/server';
import { quotePrice, Tier, ChartSystem, MagnetOption } from '../../../../lib/pricing/dynamicPricing';
import { getStripe } from '../../../../lib/clients/stripe.js';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const tier = body.tier as Tier;
  const personCount = Number(body.personCount) || 1;
  const addons = (body.addons || []) as ChartSystem[];
  const magnetType = body.magnetType as MagnetOption | undefined;
  const quote = quotePrice({ tier, personCount, addons, magnetType });

  let stripeMatch: boolean | null = null;
  try {
    const stripe = await getStripe();
    const prods = await stripe.products.list({ limit: 100, active: true, expand: ['data.default_price'] });
    const prod = prods.data.find((p: any) => p.metadata?.tier === tier && p.metadata?.is_addon !== 'true');
    if (prod?.default_price) {
      const amt = ((prod.default_price as any).unit_amount || 0) / 100;
      stripeMatch = amt === quote.base;
    }
  } catch {
    stripeMatch = null;
  }

  return NextResponse.json({ ...quote, stripeMatch });
}
