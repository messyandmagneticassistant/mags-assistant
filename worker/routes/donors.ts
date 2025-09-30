import type { Env } from '../lib/env';
import { escapeHtml, renderPage } from '../lib/pages';

type DonorModule = typeof import('../../src/donors/notion');

type DonationSummary = {
  name: string;
  amount: number;
  intent: string;
  createdAt: string;
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function loadDonorModule(): Promise<DonorModule> {
  // @ts-ignore - donation helpers are sourced from shared application code
  return await import('../../src/' + 'donors/notion');
}

function formatCurrency(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function formatDate(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  } catch {
    return date.toISOString().split('T')[0];
  }
}

function buildDonorList(donations: DonationSummary[]): string {
  if (!donations.length) {
    return `
      <div class="empty-state">
        <p>No donor entries yet—be the first to support the project!</p>
      </div>
    `;
  }

  return `<ul class="donor-list">${donations
    .map((donation) => {
      const name = donation.name ? escapeHtml(donation.name) : 'Anonymous donor';
      const amount = formatCurrency(donation.amount);
      const date = formatDate(donation.createdAt);
      const metaParts = [amount, date].filter(Boolean).map((part) => `<span>${escapeHtml(part)}</span>`);
      const meta = metaParts.length ? `<div class="donor-meta">${metaParts.join(' · ')}</div>` : '';
      const message = donation.intent ? `<div class="donor-message">${escapeHtml(donation.intent)}</div>` : '';
      return `<li><div class="donor-name">${name}</div>${meta}${message}</li>`;
    })
    .join('')}</ul>`;
}

async function renderDonorPage(env: Env): Promise<Response> {
  let donations: DonationSummary[] = [];
  let errorMessage: string | null = null;

  try {
    const mod = await loadDonorModule();
    donations = await (mod.listRecentDonations?.(25, env) ?? []);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    console.warn('[donors] Failed to fetch donor entries', errorMessage);
  }

  const hero = `
    <section class="hero">
      <p class="pill">Community wall</p>
      <h1>Messy &amp; Magnetic donors</h1>
      <p class="muted">We are keeping a running gratitude list for everyone who fuels the mission. Each entry is pulled from our Notion database using Maggie’s secure credentials.</p>
      <div class="button-row">
        <a class="button" href="mailto:hey@messyandmagnetic.com?subject=Add%20my%20donation">Add your name</a>
        <a class="button secondary" href="/donors/recent">View as JSON</a>
      </div>
    </section>
  `;

  const list = `
    <section class="section">
      <h2>Recent supporters</h2>
      ${buildDonorList(donations)}
      ${errorMessage ? `<div class="error">Unable to sync with Notion right now: ${escapeHtml(errorMessage)}.</div>` : ''}
    </section>
  `;

  return renderPage({
    title: 'Community donors',
    description: 'Recent donor acknowledgements for Messy & Magnetic, powered by our Notion database.',
    body: `${hero}${list}`,
    currentPath: '/donors',
  });
}

export async function onRequestGet({ env, request }: { env: Env; request: Request }): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/donors/recent') {
    try {
      const mod = await loadDonorModule();
      const list = await (mod.listRecentDonations?.(10, env) ?? []);
      return json({ ok: true, donors: list });
    } catch (e: any) {
      const message = e instanceof Error ? e.message : String(e);
      return json({ ok: false, error: message }, 500);
    }
  }

  if (url.pathname === '/donors' || url.pathname === '/donors/') {
    return renderDonorPage(env);
  }

  return json({ ok: false }, 404);
}

export async function onRequestPost({ env, request }: { env: Env; request: Request }) {
  const url = new URL(request.url);
  if (url.pathname !== '/donors/add') return json({ ok: false }, 404);
  if (request.headers.get('x-api-key') !== env.POST_THREAD_SECRET) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  const body = await request.json().catch(() => ({}));
  try {
    const mod = await loadDonorModule();
    await mod.recordDonation?.(body, env);
    return json({ ok: true });
  } catch (e: any) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message }, 500);
  }
}
