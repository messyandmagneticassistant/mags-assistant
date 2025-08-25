import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '../../../../../../lib/auth';
import { findImageForProduct } from '../../../../../../lib/images';
import { attachImage } from '../../../../../../lib/stripe-admin';
import { getStripe } from '../../../../../../lib/clients/stripe.js';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!checkAuth(req)) return new NextResponse('Unauthorized', { status: 401 });
  const { id } = params;
  try {
    const stripe = await getStripe();
    const prod = await stripe.products.retrieve(id);
    const img = await findImageForProduct({
      name: prod.name,
      stripeProductId: id,
    });
    if (img) {
      await attachImage(id, img);
    }
    return NextResponse.json({ ok: true, attached: !!img });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'refresh-failed' }, { status: 500 });
  }
}
