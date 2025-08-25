import { NextRequest, NextResponse } from 'next/server';
import { calculatePrice, PriceParams } from '../../../../lib/fulfillment';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const params: PriceParams = {
    tier: (searchParams.get('tier') || 'mini') as any,
    numPeople: parseInt(searchParams.get('numPeople') || '1', 10),
    numAddons: parseInt(searchParams.get('numAddons') || '0', 10),
    isChild: searchParams.get('isChild') === 'true',
    isBundle: searchParams.get('isBundle') === 'true',
    isAddon: searchParams.get('isAddon') === 'true',
  };
  const result = calculatePrice(params);
  return NextResponse.json(result);
}
