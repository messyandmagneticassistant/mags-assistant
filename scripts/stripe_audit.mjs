import fs from 'fs';
import Stripe from 'stripe';

const {
  STRIPE_SECRET_KEY,
  OPENAI_API_KEY,
  PROD_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
} = process.env;

if (!STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY is required');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

async function listAll(listFn, params = {}) {
  const items = [];
  let hasMore = true;
  let starting_after;
  while (hasMore) {
    const resp = await listFn({ limit: 100, starting_after, ...params });
    items.push(...resp.data);
    hasMore = resp.has_more;
    starting_after = resp.data[resp.data.length - 1]?.id;
  }
  return items;
}

async function fetchStripe() {
  const products = await listAll(stripe.products.list.bind(stripe.products), { active: true });
  const productInfos = [];
  const issues = [];
  const warnings = [];
  let priceCount = 0;

  for (const p of products) {
    const prices = await listAll(stripe.prices.list.bind(stripe.prices), { product: p.id });
    priceCount += prices.length;
    const normPrices = prices.map(pr => ({
      id: pr.id,
      unit_amount: pr.unit_amount,
      currency: pr.currency,
      recurring_interval: pr.recurring?.interval || null,
      active: pr.active,
    }));
    if (!prices.some(pr => pr.active)) {
      issues.push(`Product ${p.id} has no active price`);
    }
    prices.forEach(pr => {
      if (!pr.currency) issues.push(`Price ${pr.id} missing currency`);
      if (!pr.active) warnings.push(`Price ${pr.id} is inactive`);
    });
    productInfos.push({
      id: p.id,
      name: p.name,
      active: p.active,
      metadata: p.metadata,
      prices: normPrices,
    });
  }
  return { productInfos, issues, warnings, totals: { products: products.length, prices: priceCount } };
}

function parseSite(html) {
  const priceIds = new Set();
  const amounts = new Set();
  for (const m of html.matchAll(/data-price-id=["'](price_[^"']+)["']/g)) {
    priceIds.add(m[1]);
  }
  for (const m of html.matchAll(/\$\s*(\d+(?:\.\d{2})?)/g)) {
    amounts.add(m[1]);
  }
  return { priceIds, amounts };
}

async function fetchSite() {
  if (!PROD_URL) throw new Error('PROD_URL required');
  const res = await fetch(PROD_URL);
  if (!res.ok) throw new Error(`Site fetch failed: ${res.status}`);
  const html = await res.text();
  return parseSite(html);
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text })
    });
  } catch (err) {
    console.error('Telegram send failed:', err.message);
  }
}

(async () => {
  const { productInfos, issues, warnings, totals } = await fetchStripe();
  let site;
  try {
    site = await fetchSite();
  } catch (err) {
    issues.push(err.message);
  }

  if (site) {
    for (const p of productInfos) {
      for (const pr of p.prices.filter(x => x.active)) {
        const dollars = (pr.unit_amount ?? 0) / 100;
        const amtStr = dollars.toFixed(2).replace(/\.00$/, '');
        const foundId = site.priceIds.has(pr.id);
        const foundAmt = site.amounts.has(amtStr) || site.amounts.has(dollars.toFixed(2));
        if (!foundId && !foundAmt) {
          issues.push(`Donate button amount missing on site for $${amtStr}`);
        }
      }
    }

    for (const amt of site.amounts) {
      const cents = Math.round(parseFloat(amt) * 100);
      const hasPrice = productInfos.some(p => p.prices.some(pr => pr.active && pr.unit_amount === cents));
      if (!hasPrice) issues.push(`Site references amount $${amt} not found in Stripe`);
    }

    for (const id of site.priceIds) {
      const hasPrice = productInfos.some(p => p.prices.some(pr => pr.id === id));
      if (!hasPrice) issues.push(`Site references unknown price ${id}`);
    }
  }

  const data = {
    ts: new Date().toISOString(),
    products: productInfos,
    totals,
    issues: issues.concat(warnings),
  };
  fs.writeFileSync('stripe_audit.json', JSON.stringify(data, null, 2));

  const status = issues.length ? 'FAIL' : warnings.length ? 'WARN' : 'OK';
  const summary = `${status}: ${totals.products} products, ${totals.prices} prices | issues: ${issues.length + warnings.length}`;
  console.log(summary);
  if (issues.length || warnings.length) {
    for (const msg of issues.concat(warnings)) console.log(`- ${msg}`);
  }

  const teleMsg = `Mags Stripe Audit: ${issues.length ? '❌ FAIL' : '✅ OK'} (${totals.products} products, ${totals.prices} prices) | ❌ Issues: ${issues.length + warnings.length}`;
  await sendTelegram(teleMsg);

  if (issues.length) process.exit(1);
  else if (warnings.length) process.exit(78);
  else process.exit(0);
})();
