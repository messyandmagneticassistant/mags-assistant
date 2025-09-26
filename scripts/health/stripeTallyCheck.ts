import Stripe from 'stripe';
import process from 'node:process';

import { DEFAULT_PRODUCTS } from '../../config/products';

interface HealthEntry {
  ok: boolean;
  checkedAt: string;
  detail?: string;
  issues: string[];
  warnings: string[];
}

interface HealthPayload {
  website?: HealthEntry;
  stripe?: HealthEntry;
  tally?: HealthEntry;
}

interface WorkerUpdatePayload extends HealthPayload {
  metrics?: {
    flopsRecovered?: number;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

async function sendTelegramAlert(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (err) {
    console.warn('[health] telegram send failed:', err);
  }
}

function summarizeIssues(entry: HealthEntry): string {
  const issues = Array.isArray(entry.issues) ? entry.issues : [];
  const warnings = Array.isArray(entry.warnings) ? entry.warnings : [];
  const problems = issues.concat(warnings);
  return problems.length ? problems.join('\n- ') : 'all good';
}

async function runWebsiteCheck(): Promise<HealthEntry> {
  const url =
    process.env.WEBSITE_URL ||
    process.env.SITE_URL ||
    process.env.WEBSITE ||
    'https://messyandmagnetic.com';

  const entry: HealthEntry = { ok: false, checkedAt: nowIso(), issues: [], warnings: [] };

  try {
    const res = await fetch(url, { method: 'GET' });
    entry.detail = `HTTP ${res.status}`;
    entry.ok = res.ok;
    if (!res.ok) {
      entry.issues.push(`Website responded with status ${res.status}`);
    }
  } catch (err) {
    entry.detail = err instanceof Error ? err.message : String(err);
    entry.issues.push(`Website fetch failed: ${entry.detail}`);
  }

  return entry;
}

async function runStripeCheck(): Promise<HealthEntry> {
  const key =
    process.env.STRIPE_SECRET_KEY ||
    process.env.STRIPE_API_KEY ||
    process.env.STRIPE_SECRET ||
    process.env.STRIPE_TOKEN;

  const entry: HealthEntry = { ok: false, checkedAt: nowIso(), issues: [], warnings: [] };

  if (!key) {
    entry.detail = 'STRIPE_SECRET_KEY missing';
    entry.issues.push('Stripe credentials are not configured');
    return entry;
  }

  try {
    const stripe = new Stripe(key, { apiVersion: '2023-10-16' });
    const products = await stripe.products.list({ limit: 100, active: true });
    const prices = await stripe.prices.list({ limit: 100, active: true });

    const productCount = products.data.length;
    const priceCount = prices.data.length;

    const productByName = new Map<string, Stripe.Product>();
    for (const product of products.data) {
      productByName.set(product.name.toLowerCase(), product);
      if (!product.unit_label || product.unit_label.length > 12) {
        entry.warnings.push(
          `Product ${product.name} missing unit label or exceeds 12 chars (current: ${product.unit_label || 'none'})`,
        );
      }
    }

    for (const expected of DEFAULT_PRODUCTS) {
      const match = productByName.get(expected.name.toLowerCase());
      if (!match) {
        entry.issues.push(`Missing Stripe product for ${expected.name}`);
        continue;
      }
      const productPrices = prices.data.filter((price) => price.product === match.id && price.active);
      if (!productPrices.length) {
        entry.issues.push(`No active prices for ${match.name}`);
        continue;
      }
      if (expected.defaultPriceUsd && expected.defaultPriceUsd > 0) {
        const cents = Math.round(expected.defaultPriceUsd * 100);
        const found = productPrices.some((price) => price.unit_amount === cents);
        if (!found) {
          entry.issues.push(`Active price mismatch for ${match.name} (missing $${expected.defaultPriceUsd})`);
        }
      }
    }

    entry.ok = entry.issues.length === 0;
    entry.detail = `Fetched ${productCount} product(s) and ${priceCount} price(s)`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    entry.detail = message;
    entry.issues.push(`Stripe API error: ${message}`);
  }

  return entry;
}

interface TallyFormSummary {
  id: string;
  title: string;
  status?: string;
}

interface TallyResponseSummary {
  submittedAt?: string;
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T | null> {
  const res = await fetch(input, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json().catch(() => null)) as T | null;
}

function findTargetForm(forms: any[]): TallyFormSummary | null {
  if (!Array.isArray(forms)) return null;
  const targets = [
    'Create My Soul Flow System – Maggie',
    'Create My Soul Flow System - Maggie',
  ];
  for (const form of forms) {
    const title = (form?.title || form?.name || '').trim();
    if (!title) continue;
    if (targets.some((target) => title.toLowerCase() === target.toLowerCase())) {
      return { id: form.id || form.formId || form.slug, title, status: form.status };
    }
  }
  return null;
}

function normalizeSubmittedAt(response: any): string | undefined {
  const raw = response?.submittedAt || response?.createdAt || response?.created_at;
  if (typeof raw !== 'string') return undefined;
  const ts = new Date(raw);
  if (Number.isNaN(ts.getTime())) return undefined;
  return ts.toISOString();
}

async function runTallyCheck(): Promise<HealthEntry> {
  const apiKey =
    process.env.TALLY_API_KEY ||
    process.env.TALLY_API_TOKEN ||
    process.env.TALLY_SECRET_MAIN ||
    process.env.TALLY_SIGNING_SECRET;

  const entry: HealthEntry = { ok: false, checkedAt: nowIso(), issues: [], warnings: [] };

  if (!apiKey) {
    entry.detail = 'TALLY_API_KEY missing';
    entry.issues.push('Tally credentials are not configured');
    return entry;
  }

  try {
    const formsPayload = await fetchJson<{ data: any[] }>('https://api.tally.so/api/v1/forms', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const form = findTargetForm(formsPayload?.data ?? []);
    if (!form || !form.id) {
      entry.issues.push('Quiz form not found in Tally workspace');
      entry.detail = 'Unable to locate quiz form';
      return entry;
    }

    if (form.status && form.status.toLowerCase() !== 'active') {
      entry.issues.push(`Quiz form is not active (status: ${form.status})`);
    }

    const responsesPayload = await fetchJson<{ data?: any[] }>(
      `https://api.tally.so/api/v1/forms/${form.id}/responses?limit=1`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
    const lastResponse = responsesPayload?.data?.[0] as TallyResponseSummary | undefined;
    const submittedAt = lastResponse ? normalizeSubmittedAt(lastResponse) : undefined;

    if (!submittedAt) {
      entry.warnings.push('No recent responses found for quiz');
    } else {
      entry.detail = `Last response at ${submittedAt}`;
    }

    const workerUrl = process.env.WORKER_URL;
    if (workerUrl) {
      try {
        const recentSummary = await fetchJson<{ summary?: { source?: string; status?: string; completedAt?: string } | null }>(
          `${workerUrl.replace(/\/?$/, '')}/ops/recent-order`,
        );
        const summary = recentSummary?.summary;
        if (!summary || summary.source !== 'tally') {
          entry.warnings.push('Worker recent-order endpoint has no Tally-derived summary');
        } else if (summary.status !== 'success') {
          entry.issues.push(`Latest Tally order in queue is marked ${summary.status}`);
        } else if (summary.completedAt) {
          const completedAt = new Date(summary.completedAt);
          if (Number.isNaN(completedAt.getTime())) {
            entry.warnings.push('Latest Tally order completion timestamp invalid');
          } else {
            const hours = (Date.now() - completedAt.getTime()) / (1000 * 60 * 60);
            if (hours > 72) {
              entry.warnings.push('No successful Tally fulfillment in the last 72 hours');
            }
          }
        }
      } catch (err) {
        entry.warnings.push(`Worker recent-order check failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    entry.ok = entry.issues.length === 0;
    if (!entry.detail) {
      entry.detail = form ? `Form ${form.id}` : 'Form lookup complete';
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    entry.detail = message;
    entry.issues.push(`Tally API error: ${message}`);
  }

  return entry;
}

async function pushWorkerUpdate(payload: WorkerUpdatePayload): Promise<void> {
  const base = process.env.WORKER_URL;
  if (!base) return;
  const token = process.env.WORKER_KEY || process.env.POST_THREAD_SECRET || process.env.MAGGIE_WORKER_KEY;
  if (!token) {
    console.warn('[health] Missing WORKER_KEY/POST_THREAD_SECRET for health update.');
    return;
  }
  const url = `${base.replace(/\/?$/, '')}/ops/health`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[health] Worker update failed:', res.status, text);
    }
  } catch (err) {
    console.warn('[health] Unable to update worker health state:', err);
  }
}

async function main(): Promise<void> {
  const website = await runWebsiteCheck();
  const stripe = await runStripeCheck();
  const tally = await runTallyCheck();

  const payload: WorkerUpdatePayload = {
    website,
    stripe,
    tally,
  };

  await pushWorkerUpdate(payload);

  const anyFailure = !website.ok || !stripe.ok || !tally.ok;
  const summary = [
    `Website: ${website.ok ? 'ok' : 'fail'} (${website.detail ?? 'n/a'})`,
    `Stripe: ${stripe.ok ? 'ok' : 'fail'} (${stripe.detail ?? 'n/a'})`,
    `Tally: ${tally.ok ? 'ok' : 'fail'} (${tally.detail ?? 'n/a'})`,
  ].join(' | ');
  console.log('[health] Summary:', summary);

  if (anyFailure) {
    const alert =
      '⚠️ Health check alert\n' +
      `Stripe → ${stripe.ok ? '✅' : '❌'}\n${summarizeIssues(stripe)}\n\n` +
      `Tally → ${tally.ok ? '✅' : '❌'}\n${summarizeIssues(tally)}\n\n` +
      `Website → ${website.ok ? '✅' : '❌'}\n${summarizeIssues(website)}`;
    await sendTelegramAlert(alert);
    process.exitCode = 1;
  }
}

await main();
