export const env = {
  API_BASE: process.env.API_BASE,
  FETCH_PASS: process.env.FETCH_PASS,
  GOOGLE_KEY_URL: process.env.GOOGLE_KEY_URL,
  WORKER_KEY: process.env.WORKER_KEY,
  MAGS_KEY: process.env.MAGS_KEY,
  CRON_SECRET: process.env.CRON_SECRET,
  NOTION_TOKEN: process.env.NOTION_TOKEN,
  NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID,
  NOTION_INBOX_PAGE_ID: process.env.NOTION_INBOX_PAGE_ID,
  NOTION_HQ_PAGE_ID: process.env.NOTION_HQ_PAGE_ID,
  BROWSERLESS_API_KEY: process.env.BROWSERLESS_API_KEY,
  BROWSERLESS_TOKEN: process.env.BROWSERLESS_TOKEN || process.env.BROWSERLESS_API_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  NOTION_STRIPE_DB_ID: process.env.NOTION_STRIPE_DB_ID,
  NOTION_DB_RUNS_ID: process.env.NOTION_DB_RUNS_ID,
  NOTION_QUEUE_DB_ID: process.env.NOTION_QUEUE_DB_ID,
  NOTION_QUEUE_DB: process.env.NOTION_QUEUE_DB,
  NOTION_SOCIAL_DB: process.env.NOTION_SOCIAL_DB,
  DRIVE_PRODUCT_IMAGES_ROOT_ID: process.env.DRIVE_PRODUCT_IMAGES_ROOT_ID,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM: process.env.RESEND_FROM,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  TELEGRAM_CALLBACK_SECRET: process.env.TELEGRAM_CALLBACK_SECRET,
  TIKTOK_APP_ID: process.env.TIKTOK_APP_ID,
  TIKTOK_APP_SECRET: process.env.TIKTOK_APP_SECRET,
  TIKTOK_REDIRECT_URL: process.env.TIKTOK_REDIRECT_URL,
  TIKTOK_ACCESS_TOKEN: process.env.TIKTOK_ACCESS_TOKEN,
  TIKTOK_REFRESH_TOKEN: process.env.TIKTOK_REFRESH_TOKEN,
  TALLY_API_KEY: process.env.TALLY_API_KEY,
  TALLY_WEBHOOK_SECRET: process.env.TALLY_WEBHOOK_SECRET,
  GAS_INTAKE_URL: process.env.GAS_INTAKE_URL,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  SCRAPER_PROVIDER: process.env.SCRAPER_PROVIDER || 'actions',
  MASTER_MEMORY_SHEET_ID: process.env.MASTER_MEMORY_SHEET_ID,
  PRICE_HISTORY_SHEET_ID: process.env.PRICE_HISTORY_SHEET_ID,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  MM_DRIVE_ROOT_ID: process.env.MM_DRIVE_ROOT_ID,
  CHAN_DRIVE_ROOT_ID: process.env.CHAN_DRIVE_ROOT_ID,
  MM_DRIVE_INBOX_ID: process.env.MM_DRIVE_INBOX_ID,
  MM_DRIVE_REVIEW_ID: process.env.MM_DRIVE_REVIEW_ID,
  MM_DRIVE_READY_ID: process.env.MM_DRIVE_READY_ID,
  MM_DRIVE_ARCHIVE_ID: process.env.MM_DRIVE_ARCHIVE_ID,
  MM_DRIVE_FAILED_ID: process.env.MM_DRIVE_FAILED_ID,
  MM_DRIVE_CHANCUB_PARENT_ID: process.env.MM_DRIVE_CHANCUB_PARENT_ID,
  MM_DRIVE_MM_PARENT_ID: process.env.MM_DRIVE_MM_PARENT_ID,
  SALES_TAX_STATE: process.env.SALES_TAX_STATE,
  SALES_TAX_ZIP: process.env.SALES_TAX_ZIP,
  DALL_E_STYLE_PROMPT: process.env.DALL_E_STYLE_PROMPT,
  GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || '',
  GCP_SA_EMAIL: process.env.GCP_SA_EMAIL || '',
  GCP_SA_KEY_JSON: process.env.GCP_SA_KEY_JSON || '',
  GCP_SCOPES:
    process.env.GCP_SCOPES || 'https://www.googleapis.com/auth/cloud-platform',
  GCP_DO_DISABLE:
    process.env.GCP_DO_DISABLE === '1' ||
    process.env.GCP_DO_DISABLE === 'true',
  DRY_RUN: process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true',
  ALLOWED_DOMAINS: (process.env.ALLOWED_DOMAINS || '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean),
  EXECUTION_PAUSED: process.env.EXECUTION_PAUSED === '1' || process.env.EXECUTION_PAUSED === 'true',
};

export function requireEnv(name) {
  const v = env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
