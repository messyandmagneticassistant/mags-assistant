#!/usr/bin/env node

const REQUIRED_KEYS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
];

const IMPORTANT_KEYS = [
  'STRIPE_KEY',
  'STRIPE_API_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TELEGRAM_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'GITHUB_PAT',
  'GITHUB_TOKEN',
  'TALLY_FORM_ID',
  'NOTION_API_KEY',
  'BROWSERLESS_KEY',
  'BROWSERLESS_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'CODEX_SYNC_URL',
  'CODEX_AUTH_TOKEN',
  'POST_THREAD_SECRET',
  'SECRET_BLOB',
  'BRAIN_DOC_KEY',
  'POSTQ_KV_NAMESPACE',
  'POSTQ_KV_TOKEN',
];

const fallbackJson = process.env.MAGGIE_CONFIG_JSON;
let fallback = {};
if (fallbackJson && fallbackJson.trim()) {
  try {
    fallback = JSON.parse(fallbackJson);
  } catch (err) {
    console.warn('[validate-config] Unable to parse MAGGIE_CONFIG_JSON fallback:', err?.message || err);
  }
}

function resolveValue(key) {
  const envValue = process.env[key];
  if (typeof envValue === 'string' && envValue.trim().length > 0) {
    return { present: true, via: 'env' };
  }

  const fbValue = fallback[key];
  if (fbValue !== undefined && fbValue !== null && String(fbValue).trim().length > 0) {
    return { present: true, via: 'fallback' };
  }

  return { present: false };
}

const summary = {};

for (const key of [...REQUIRED_KEYS, ...IMPORTANT_KEYS]) {
  summary[key] = resolveValue(key);
}

const missingRequired = REQUIRED_KEYS.filter((key) => !summary[key].present);
const missingImportant = IMPORTANT_KEYS.filter((key) => !summary[key].present);

if (missingImportant.length > 0) {
  console.warn('[validate-config] Missing optional-but-important keys:');
  for (const key of missingImportant) {
    console.warn(`  - ${key}`);
  }
}

if (missingRequired.length > 0) {
  console.error('[validate-config] Required configuration is missing:');
  for (const key of missingRequired) {
    console.error(`  - ${key}`);
  }
  process.exit(1);
}

const viaFallback = Object.entries(summary)
  .filter(([, result]) => result.present && result.via === 'fallback')
  .map(([key]) => key);

if (viaFallback.length > 0) {
  console.log('[validate-config] Using fallback config for:', viaFallback.join(', '));
}

console.log('[validate-config] Configuration looks good.');
