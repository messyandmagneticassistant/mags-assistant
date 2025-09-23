import fs from 'fs';
import path from 'path';
import Stripe from 'stripe';

const NOTION_VERSION = '2022-06-28';

const now = new Date();
const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
const since = new Date(now.getTime() - sevenDaysMs);

const currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

interface StripeSummary {
  totalCents: number;
  count: number;
  currency: string;
  donationEvents: StripeDonationEvent[];
  message: string;
}

interface StripeDonationEvent {
  amountCents: number;
  currency: string;
  donor?: string;
  created: Date;
  note?: string;
}

interface NotionDonationEntry {
  created: Date;
  name?: string;
  amount?: number;
  note?: string;
}

interface DeployEntry {
  created: Date;
  summary: string;
  source: string;
}

function formatCurrency(cents: number, currency = 'usd') {
  if (!Number.isFinite(cents) || !cents) return '$0';
  const formatter =
    currency.toLowerCase() === 'usd'
      ? currencyFmt
      : new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() as any });
  return formatter.format(cents / 100);
}

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function relativeTime(date: Date) {
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays > 7) return `${Math.round(diffDays / 7)}w ago`;
  return `${diffDays}d ago`;
}

function isDonationIntent(pi: Stripe.PaymentIntent): boolean {
  const pieces: string[] = [];
  if (pi.description) pieces.push(pi.description);
  if (pi.statement_descriptor) pieces.push(pi.statement_descriptor);
  const metadata = pi.metadata || {};
  for (const value of Object.values(metadata)) {
    if (value) pieces.push(String(value));
  }
  if (pi.charges && 'data' in pi.charges) {
    for (const charge of pi.charges.data || []) {
      if (charge?.description) pieces.push(charge.description);
      if (charge?.statement_descriptor) pieces.push(charge.statement_descriptor);
      if (charge?.billing_details?.name) pieces.push(charge.billing_details.name);
      if (charge?.metadata) {
        for (const value of Object.values(charge.metadata)) {
          if (value) pieces.push(String(value));
        }
      }
    }
  }
  const joined = pieces.join(' ').toLowerCase();
  if (!joined) return false;
  if (joined.includes('donation')) return true;
  if (joined.includes('donor')) return true;
  if (joined.includes('prod_donation')) return true;
  if (joined.includes('donate')) return true;
  return false;
}

async function fetchStripeSummary(): Promise<StripeSummary> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return {
      totalCents: 0,
      count: 0,
      currency: 'usd',
      donationEvents: [],
      message: 'Stripe: STRIPE_SECRET_KEY missing – skipped.',
    };
  }

  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });
  const sinceTs = Math.floor(since.getTime() / 1000);

  const payments: Stripe.PaymentIntent[] = [];
  let starting_after: string | undefined;
  try {
    while (true) {
      const page = await stripe.paymentIntents.list({
        limit: 100,
        created: { gte: sinceTs },
        starting_after,
        expand: ['data.charges'],
      });
      payments.push(...page.data);
      if (!page.has_more) break;
      starting_after = page.data[page.data.length - 1]?.id;
      if (!starting_after) break;
    }
  } catch (err) {
    return {
      totalCents: 0,
      count: 0,
      currency: 'usd',
      donationEvents: [],
      message: `Stripe: fetch failed – ${(err as Error).message}`,
    };
  }

  const successful = payments.filter((pi) =>
    ['succeeded', 'requires_capture'].includes(pi.status || '') && (pi.amount_received ?? pi.amount ?? 0) > 0
  );

  const totalCents = successful.reduce((sum, pi) => sum + (pi.amount_received ?? pi.amount ?? 0), 0);
  const currency = successful[0]?.currency || 'usd';

  const donationEvents: StripeDonationEvent[] = successful
    .filter((pi) => isDonationIntent(pi))
    .map((pi) => {
      const cents = pi.amount_received ?? pi.amount ?? 0;
      const charge = pi.charges && 'data' in pi.charges ? pi.charges.data?.[0] : undefined;
      const donor =
        (pi.metadata?.customer_name as string | undefined) ||
        (charge?.billing_details?.name as string | undefined) ||
        (pi.metadata?.name as string | undefined) ||
        (pi.metadata?.donor as string | undefined);
      const note =
        (pi.metadata?.intent as string | undefined) ||
        (pi.metadata?.note as string | undefined) ||
        (charge?.description as string | undefined) ||
        undefined;
      return {
        amountCents: cents,
        currency: pi.currency || 'usd',
        donor,
        created: new Date((pi.created || 0) * 1000),
        note,
      };
    })
    .filter((entry) => entry.created >= since)
    .sort((a, b) => b.created.getTime() - a.created.getTime());

  return {
    totalCents,
    count: successful.length,
    currency,
    donationEvents,
    message: `Stripe: ${successful.length} sale(s) totaling ${formatCurrency(totalCents, currency)}.`,
  };
}

function parseNotionText(prop: any): string {
  if (!prop) return '';
  if (prop.type === 'title' || prop.type === 'rich_text') {
    const content = (prop[prop.type] || [])
      .map((p: any) => (typeof p.plain_text === 'string' ? p.plain_text : ''))
      .join('')
      .trim();
    if (content) return content;
  }
  if (prop.type === 'select') return prop.select?.name || '';
  if (prop.type === 'multi_select') return (prop.multi_select || []).map((item: any) => item.name).join(', ');
  if (prop.type === 'url') return prop.url || '';
  if (prop.type === 'email') return prop.email || '';
  if (prop.type === 'phone_number') return prop.phone_number || '';
  if (prop.type === 'people') return (prop.people || []).map((p: any) => p.name || p.id).join(', ');
  if (prop.type === 'formula' && prop.formula?.type === 'string') return prop.formula.string || '';
  if (prop.type === 'rollup' && prop.rollup?.type === 'array') {
    return (prop.rollup.array || [])
      .map((item: any) => parseNotionText(item))
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

function parseNotionNumber(prop: any): number | undefined {
  if (!prop) return undefined;
  if (prop.type === 'number') return typeof prop.number === 'number' ? prop.number : undefined;
  if (prop.type === 'formula' && prop.formula?.type === 'number') return prop.formula.number ?? undefined;
  if (prop.type === 'rollup' && prop.rollup?.type === 'number') return prop.rollup.number ?? undefined;
  return undefined;
}

async function fetchNotionDonations(): Promise<{ entries: NotionDonationEntry[]; message: string }> {
  const token = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  const dbId = process.env.NOTION_DB_LOGS || process.env.NOTION_DB_ID;
  if (!token || !dbId) {
    return {
      entries: [],
      message: 'Notion: donor database not configured.',
    };
  }

  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION,
      },
      body: JSON.stringify({
        page_size: 50,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      }),
    });
    if (!res.ok) {
      return {
        entries: [],
        message: `Notion: query failed – HTTP ${res.status}`,
      };
    }
    const data: any = await res.json();
    const results: any[] = Array.isArray(data.results) ? data.results : [];
    const entries: NotionDonationEntry[] = results
      .map((page) => {
        const created = new Date(page.created_time || page.last_edited_time || 0);
        const props = page.properties || {};
        const name =
          parseNotionText(props.Name) ||
          parseNotionText(props.Title) ||
          parseNotionText(props.Donor) ||
          parseNotionText(props.Contact) ||
          undefined;
        const amount =
          parseNotionNumber(props.Amount) ??
          parseNotionNumber(props.Value) ??
          parseNotionNumber(props.USD) ??
          undefined;
        const note =
          parseNotionText(props.Intent) ||
          parseNotionText(props.Notes) ||
          parseNotionText(props.Summary) ||
          parseNotionText(props.Update) ||
          undefined;
        return { created, name, amount, note };
      })
      .filter((entry) => entry.created && entry.created >= since)
      .sort((a, b) => b.created.getTime() - a.created.getTime());

    const msg = entries.length
      ? `Notion: ${entries.length} donor update(s) logged.`
      : 'Notion: no donor entries in the last week.';
    return { entries, message: msg };
  } catch (err) {
    return {
      entries: [],
      message: `Notion: fetch failed – ${(err as Error).message}`,
    };
  }
}

function parseDeployLogs(): { entries: DeployEntry[]; message: string } {
  const candidates: string[] = [];
  const searchDirs = ['.', 'logs', 'data', 'docs', 'intel'];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch (err) {
      continue;
    }
    for (const file of entries) {
      const lower = file.toLowerCase();
      if (lower.includes('publishsite') || lower.includes('publish-site')) {
        const full = path.join(dir, file);
        if (fs.statSync(full).isFile()) candidates.push(full);
      }
    }
  }

  const seen = new Set<string>();
  const deploys: DeployEntry[] = [];

  for (const file of candidates) {
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      const raw = fs.readFileSync(file, 'utf8');
      try {
        const json = JSON.parse(raw);
        const jsonEntries = extractDeployEntriesFromJson(json, file);
        deploys.push(...jsonEntries);
        continue;
      } catch (jsonErr) {
        const textEntries = extractDeployEntriesFromText(raw, file);
        deploys.push(...textEntries);
      }
    } catch (err) {
      // ignore file read errors
    }
  }

  const recent = deploys
    .filter((entry) => entry.created >= since)
    .sort((a, b) => b.created.getTime() - a.created.getTime());

  if (recent.length) {
    return { entries: recent, message: `Deploys: ${recent.length} publishSite run(s) found.` };
  }

  return {
    entries: [],
    message: candidates.length
      ? 'Deploys: no publishSite entries in the last week.'
      : 'Deploys: no publishSite logs found.',
  };
}

function extractDeployEntriesFromJson(json: any, source: string): DeployEntry[] {
  const entries: DeployEntry[] = [];
  const maybeArray = Array.isArray(json) ? json : Array.isArray(json?.entries) ? json.entries : json?.logs;
  if (Array.isArray(maybeArray)) {
    for (const item of maybeArray) {
      const entry = buildDeployEntry(item, source);
      if (entry) entries.push(entry);
    }
    return entries;
  }
  const entry = buildDeployEntry(json, source);
  return entry ? [entry] : [];
}

function buildDeployEntry(item: any, source: string): DeployEntry | null {
  if (!item || typeof item !== 'object') return null;
  const dateStr =
    item.ts ||
    item.timestamp ||
    item.time ||
    item.date ||
    item.created_at ||
    item.created ||
    item.last_run ||
    item.updated_at ||
    item.lastUpdated;
  if (dateStr) {
    const created = new Date(dateStr);
    if (!Number.isNaN(created.getTime())) {
      const summary =
        item.summary ||
        item.status ||
        item.note ||
        item.message ||
        item.result ||
        item.outcome ||
        JSON.stringify(item);
      return { created, summary: String(summary), source };
    }
  }
  if (item.log && typeof item.log === 'string') {
    const fromText = extractDeployEntriesFromText(item.log, source);
    return fromText[0] || null;
  }
  return null;
}

function extractDeployEntriesFromText(raw: string, source: string): DeployEntry[] {
  const entries: DeployEntry[] = [];
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const isoMatch = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/);
    const dateMatch =
      isoMatch?.[0] ||
      line.match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/)?.[0] ||
      line.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (dateMatch) {
      const created = new Date(dateMatch);
      if (!Number.isNaN(created.getTime())) {
        const summary = line.replace(dateMatch, '').trim() || 'publishSite run';
        entries.push({ created, summary, source });
      }
    }
  }
  return entries;
}

async function fetchDonorPageUpdate(): Promise<string> {
  const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
  const pageId = process.env.NOTION_DONOR_PAGE_ID;
  if (!token || !pageId) return 'Notion donor page: no access configured.';
  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
      },
    });
    if (!res.ok) return `Notion donor page: HTTP ${res.status}.`;
    const data: any = await res.json();
    const lastEdited = data?.last_edited_time ? new Date(data.last_edited_time) : null;
    if (lastEdited && !Number.isNaN(lastEdited.getTime())) {
      if (lastEdited >= since) {
        return `Notion donor page updated ${relativeTime(lastEdited)} (${lastEdited.toISOString().slice(0, 16)}Z).`;
      }
      return `Notion donor page last touched ${lastEdited.toISOString().slice(0, 10)}.`;
    }
    return 'Notion donor page: no edit timestamp available.';
  } catch (err) {
    return `Notion donor page: ${(err as Error).message}`;
  }
}

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error('[weeklyDigest] telegram error', err);
  }
}

function summarizeDonations(entries: (StripeDonationEvent | NotionDonationEntry)[]): string[] {
  return entries.slice(0, 5).map((entry) => {
    const created = 'created' in entry ? entry.created : new Date();
    const when = `${formatDate(created)} (${relativeTime(created)})`;
    const amount = 'amountCents' in entry
      ? formatCurrency(entry.amountCents, entry.currency)
      : entry.amount
        ? formatCurrency(Math.round(entry.amount * 100))
        : '$0';
    const name = 'donor' in entry ? entry.donor : entry.name;
    const note = 'note' in entry ? entry.note : undefined;
    const pieces = [amount];
    if (name) pieces.push(`for ${name}`);
    pieces.push(when);
    if (note) pieces.push(`– ${note}`);
    return `- ${pieces.filter(Boolean).join(' ')}`;
  });
}

async function main() {
  console.log(`Weekly digest window: ${since.toISOString()} → ${now.toISOString()}`);

  const [stripeSummary, notionDonations, donorPageMessage] = await Promise.all([
    fetchStripeSummary(),
    fetchNotionDonations(),
    fetchDonorPageUpdate(),
  ]);

  const deploys = parseDeployLogs();

  const donationLines = summarizeDonations([
    ...stripeSummary.donationEvents,
    ...notionDonations.entries,
  ]);

  const summaryLines = [
    `Weekly Digest (${formatDate(since)} – ${formatDate(now)})`,
    '',
    '• Donations & Sales',
    `  - ${stripeSummary.message}`,
  ];

  if (donationLines.length) {
    summaryLines.push('  - Donation highlights:');
    summaryLines.push(...donationLines.map((line) => `    ${line}`));
  } else {
    summaryLines.push('  - No new donation entries detected.');
  }

  summaryLines.push('', '• Deploy Activity', `  - ${deploys.message}`);
  if (deploys.entries.length) {
    for (const entry of deploys.entries.slice(0, 5)) {
      summaryLines.push(
        `    - ${formatDate(entry.created)} (${relativeTime(entry.created)}) – ${entry.summary} [${path.basename(entry.source)}]`
      );
    }
  }

  summaryLines.push('', '• Donor / Stripe Updates');
  summaryLines.push(`  - ${notionDonations.message}`);
  summaryLines.push(`  - ${donorPageMessage}`);

  const text = summaryLines.join('\n');
  console.log('\n' + text + '\n');

  await sendTelegram(text);
}

main().catch((err) => {
  console.error('[weeklyDigest] fatal', err);
  process.exit(1);
});
