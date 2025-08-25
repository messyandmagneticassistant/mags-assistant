import { getStripe } from '../clients/stripe.js';
import { getBasePrice, Tier } from '../pricing/dynamicPricing';

async function sendAlert(msg: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_DEV_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: msg }),
    });
  } catch {}
}

export async function validateProducts() {
  const stripe = await getStripe();
  const prods = await stripe.products.list({ limit: 100, expand: ['data.default_price'] });
  for (const p of prods.data) {
    const tier = p.metadata?.tier as Tier | undefined;
    const basePrice = p.metadata?.base_price ? Number(p.metadata.base_price) : null;
    if (!tier || basePrice === null) continue;
    const expected = getBasePrice(tier);
    if (expected !== basePrice) {
      const msg = `Price mismatch for ${p.name}: stripe meta=${basePrice} expected=${expected}`;
      console.error(msg);
      await sendAlert(msg);
    }
    const price = (p.default_price as any)?.unit_amount;
    if (price !== undefined && price / 100 !== expected) {
      const msg = `Default price mismatch for ${p.name}: stripe=${price / 100} expected=${expected}`;
      console.error(msg);
      await sendAlert(msg);
    }
  }
}
