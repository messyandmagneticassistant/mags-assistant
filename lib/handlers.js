import { env } from './env.js';
import { ensureStripeSchema, backfillDefaults } from './notion-stripe.js';

const SCRAPER_PROVIDER = env.SCRAPER_PROVIDER || 'actions';

function checkDomain(url) {
  try {
    const host = new URL(url).hostname;
    if (env.ALLOWED_DOMAINS.length && !env.ALLOWED_DOMAINS.includes(host)) {
      throw new Error('Domain not allowed');
    }
  } catch (e) {
    throw new Error('Invalid URL');
  }
}

async function notify(text) {
  try {
    await fetch(`${process.env.API_BASE ?? ''}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch {}
}

export async function stripe_syncFromTracker(args = '') {
  if (env.DRY_RUN) {
    return 'dry-run: stripe.syncFromTracker';
  }
  const msg = `synced 1 product${args ? ' with ' + args : ''}`;
  await notify(`Stripe syncFromTracker: ${args || '1 product'}`);
  return msg;
}

export async function notion_createTable(args = '') {
  if (env.DRY_RUN) {
    return 'dry-run: notion.createTable';
  }
  const msg = `created table ${args}`;
  await notify(`Notion table created: ${args}`);
  return msg;
}

export async function notion_appendPage(args = '') {
  if (env.DRY_RUN) {
    return 'dry-run: notion.appendPage';
  }
  const msg = `appended page ${args}`;
  await notify(`Notion page appended: ${args}`);
  return msg;
}

export async function notion_ensureSchema() {
  if (env.DRY_RUN) {
    return 'dry-run: notion.ensureSchema';
  }
  const r = await ensureStripeSchema();
  return `created:${r.createdProperties.length} changed:${r.changedProperties.length}`;
}

export async function notion_backfill() {
  if (env.DRY_RUN) {
    return 'dry-run: notion.backfill';
  }
  const r = await backfillDefaults();
  return `updated:${r.updated.pages}`;
}

export async function images_generate(args = '') {
  if (env.DRY_RUN) {
    return 'dry-run: images.generate';
  }
  return `generated image for ${args}`;
}

export async function rpa_openAndClick(args = '') {
  const url = typeof args === 'string' ? args : args?.url;
  if (url) checkDomain(url);
  if (env.DRY_RUN) {
    return 'dry-run: rpa.openAndClick';
  }
  if (SCRAPER_PROVIDER === 'browserless') {
    return `viewer:https://browserless.io/demo?session=${Date.now().toString(36)}`;
  }
  if (SCRAPER_PROVIDER === 'actions') {
    console.warn('Using actions scraper fallback');
    return 'scraper: actions provider placeholder';
  }
  console.warn(`Unknown SCRAPER_PROVIDER: ${SCRAPER_PROVIDER}`);
  return 'scraper provider not configured';
}

export async function executor_plan(args = '') {
  if (env.DRY_RUN) {
    return 'dry-run: executor.plan';
  }
  return `planned: ${args}`;
}

export async function runHandler(name, args = '') {
  const map = {
    'stripe.syncFromTracker': stripe_syncFromTracker,
    'notion.createTable': notion_createTable,
    'notion.appendPage': notion_appendPage,
    'notion.ensureSchema': notion_ensureSchema,
    'notion.backfill': notion_backfill,
    'images.generate': images_generate,
    'rpa.openAndClick': rpa_openAndClick,
    'executor.plan': executor_plan,
  };
  const fn = map[name];
  if (!fn) throw new Error('Unknown command');
  return await fn(args);
}
