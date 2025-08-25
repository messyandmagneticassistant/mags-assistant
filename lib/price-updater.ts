import { appendRows } from './google.js';
import { env, requireEnv } from './env.js';

interface PriceChangeLog {
  timestamp: string;
  productId: string;
  oldPrice: number;
  newPrice: number;
  flagged: boolean;
}

interface ProposePriceOptions {
  description: string;
  tier: string;
  current: number;
  baseTierPrice?: number;
}

async function proposePrice(opts: ProposePriceOptions): Promise<{ price: number; flagged: boolean }> {
  let proposed = opts.current;
  if (env.OPENAI_API_KEY) {
    try {
      const prompt = `You are a pricing assistant for spiritual and esoteric readings. Given the product description and tier, suggest a market aligned USD price. Maintain tier scaling (Full > Lite > Mini) and keep add-ons below their base tier with a second family member around 80% of the base price. Return only a number.`;
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'gpt-4.1-mini', input: prompt + `\nDescription: ${opts.description}\nTier: ${opts.tier}\nCurrent: ${opts.current}` }),
      });
      const data: any = await res.json();
      const text = data?.output_text || data?.choices?.[0]?.message?.content || '';
      const num = parseFloat(String(text).replace(/[^0-9.]/g, ''));
      if (!isNaN(num)) proposed = num;
    } catch {}
  }
  if (opts.tier.toLowerCase().includes('add-on') && opts.baseTierPrice) {
    proposed = Math.min(proposed, opts.baseTierPrice * 0.8);
  }
  if (opts.baseTierPrice) {
    if (opts.tier.toLowerCase().includes('lite') || opts.tier.toLowerCase().includes('mini')) {
      proposed = Math.min(proposed, opts.baseTierPrice - 1);
    }
  }
  proposed = Math.round(proposed);
  const flagged = Math.abs(proposed - opts.current) > 25;
  return { price: proposed, flagged };
}

export async function runPriceUpdater() {
  const stripeKey = requireEnv('STRIPE_SECRET_KEY');
  const sheetId = env.PRICE_HISTORY_SHEET_ID;
  const productsRes = await fetch('https://api.stripe.com/v1/products?active=true&limit=100', {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  const products: any = await productsRes.json();
  const logs: PriceChangeLog[] = [];
  for (const product of products.data || []) {
    const priceRes = await fetch(`https://api.stripe.com/v1/prices?active=true&product=${product.id}&limit=1`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    const priceData: any = await priceRes.json();
    const current = priceData.data?.[0];
    const currentAmount = current ? current.unit_amount / 100 : 0;
    const { price: proposed, flagged } = await proposePrice({
      description: product.description || '',
      tier: product.metadata?.tier || '',
      current: currentAmount,
      baseTierPrice: Number(product.metadata?.base_price),
    });
    if (current && proposed !== currentAmount) {
      await fetch(`https://api.stripe.com/v1/prices/${current.id}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ active: 'false' }),
      });
      const body = new URLSearchParams({
        product: product.id,
        unit_amount: String(Math.round(proposed * 100)),
        currency: 'usd',
      });
      await fetch('https://api.stripe.com/v1/prices', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      logs.push({
        timestamp: new Date().toISOString(),
        productId: product.id,
        oldPrice: currentAmount,
        newPrice: proposed,
        flagged,
      });
      if (flagged && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text: `Price jump > $25 for ${product.name}: ${currentAmount} -> ${proposed}`,
          }),
        });
      }
    }
  }
  if (sheetId && logs.length) {
    const rows = logs.map((l) => [l.timestamp, l.productId, l.oldPrice, l.newPrice, l.flagged ? 'FLAG' : '']);
    await appendRows(sheetId, 'Price History Log!A:E', rows);
  }
  return { updated: logs.length };
}
