import { NextRequest, NextResponse } from 'next/server';
import { estimatePrice, Tier } from '../../../../lib/pricing/auto-pricing';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tier = (searchParams.get('tier') || 'mini') as Tier;
  const count = parseInt(searchParams.get('count') || '1', 10);
  const addons = searchParams.get('addons')?.split(',').filter(Boolean) || [];
  const depth = (searchParams.get('depth') as 'base' | 'deep') || 'base';
  const system = searchParams.get('system') === 'true';
  const result = estimatePrice({ tier, count, addons, depth, system });
  return NextResponse.json(result);
}
