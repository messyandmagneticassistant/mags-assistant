import fetch from 'node-fetch';
import fs from 'fs/promises';

export type Tier = 'mini' | 'lite' | 'full';

export interface PriceParams {
  tier: Tier;
  numPeople?: number;
  numAddons?: number;
  isChild?: boolean;
  isBundle?: boolean;
  isAddon?: boolean;
}

export interface PriceResult {
  total: number;
  breakdown: {
    base: number;
    extras: number;
    addons: number;
    discounts: number;
  };
  summary: string;
}

const BASE_PRICES: Record<Tier, number> = {
  mini: 44,
  lite: 88,
  full: 144,
};

const EXTRA_PERSON_PRICES: Record<Tier, number> = {
  mini: 44,
  lite: 55,
  full: 111,
};

export function calculatePrice(params: PriceParams): PriceResult {
  const tier = params.tier;
  const base = BASE_PRICES[tier];
  const extrasCount = Math.max((params.numPeople ?? 1) - 1, 0);
  const extraPrice = extrasCount * EXTRA_PERSON_PRICES[tier];
  const addonUnit = EXTRA_PERSON_PRICES[tier];
  let addonCount = params.numAddons ?? 0;
  let discounts = 0;

  // child-friendly explanation promo
  if (params.isChild) {
    discounts += addonUnit; // treat as free addon
    addonCount = Math.max(addonCount - 1, 0);
  }

  let addons = addonCount * addonUnit;

  // bundle discount simple 10%
  let total = base + extraPrice + addons;
  if (params.isBundle) {
    const d = Math.round(total * 0.1);
    discounts += d;
    total -= d;
  }

  // addon flag does not change price but noted in summary
  const summaryParts = [`base $${base}`];
  if (extrasCount) summaryParts.push(`extras x${extrasCount} $${extraPrice}`);
  if (addons) summaryParts.push(`addons x${addonCount} $${addons}`);
  if (discounts) summaryParts.push(`discounts -$${discounts}`);
  if (params.isAddon) summaryParts.push('as addon');

  return {
    total,
    breakdown: { base, extras: extraPrice, addons, discounts },
    summary: summaryParts.join(', '),
  };
}

export interface ResendOptions {
  personId: string;
  method?: 'email' | 'telegram' | 'all';
  force?: boolean;
  reason?: string;
}

async function sendEmail(to: string, link: string): Promise<boolean> {
  try {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('missing RESEND_API_KEY');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        from: 'Mags Ops <ops@messyandmagnetic.com>',
        to,
        subject: 'Your reading',
        html: `<p>Your reading is ready: <a href="${link}">view here</a></p>`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text }),
  }).catch(() => {});
}

async function sendTelegram(link: string): Promise<boolean> {
  try {
    await sendTelegramMessage(`Reading available: ${link}`);
    return true;
  } catch {
    return false;
  }
}

export async function resendReading(opts: ResendOptions): Promise<{ ok: boolean; method: string; }>{
  const method = opts.method || 'email';
  const link = `https://drive.google.com/${opts.personId}.pdf`;
  let sent = false;
  let used = method;
  if (method === 'email' || method === 'all') {
    sent = await sendEmail(`${opts.personId}@example.com`, link);
    if (!sent && method === 'email') {
      await sendTelegramMessage(`Email delivery failed for ${opts.personId}, retrying via Telegram.`);
      sent = await sendTelegram(link);
      used = sent ? 'telegram' : 'email';
    }
  }
  if (!sent && (method === 'telegram' || method === 'all')) {
    sent = await sendTelegram(link);
    used = 'telegram';
  }

  const logPath = 'data/fulfillment-log.json';
  let log: any[] = [];
  try {
    const existing = await fs.readFile(logPath, 'utf-8');
    log = JSON.parse(existing);
  } catch {}
  log.push({ personId: opts.personId, method: used, ok: sent, reason: opts.reason, ts: Date.now() });
  await fs.mkdir('data', { recursive: true });
  await fs.writeFile(logPath, JSON.stringify(log, null, 2));

  const sends = log.filter((l) => l.personId === opts.personId);
  if (sends.length > 3) {
    await sendTelegramMessage(`Alert: reading for ${opts.personId} sent ${sends.length} times`);
  }

  return { ok: sent, method: used };
}

