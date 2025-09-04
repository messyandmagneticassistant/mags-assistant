# Inventory – Web / Worker

## Current Cloudflare Worker Routes

| Method | Path | File |
| ------ | ---- | ---- |
| GET | `/health` | `worker/health.ts` |
| GET | `/diag/config` | `worker/health.ts` |
| POST | `/api/browser/session` | `worker/routes/browser.ts` |
| * | other paths (`/webhooks/*`, `/ai/*`, `/api/appscript`, `/tiktok/*`, `/tasks/*`, `/cron/*`, `/telegram-webhook`, `/ready`) | router stubs in `worker/worker.ts` (modules missing) |

The root path (`/`) responds with a simple "mags ok" string when no other route matches.

## Environment Variables Referenced

The worker's diagnostic config loader checks for the following variables (loaded from KV `thread-state` if present):

- **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- **Tally:** `TALLY_API_KEY`, `TALLY_SIGNING_SECRET`, `TALLY_WEBHOOK_FEEDBACK_ID`, `TALLY_WEBHOOK_QUIZ_ID`
- **Telegram:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- **Notion:** `NOTION_API_KEY`, `NOTION_DB_ID`, `NOTION_TOKEN`, `NOTION_DB_LOGS`
- **TikTok sessions:** `TIKTOK_SESSION_MAIN`, `TIKTOK_SESSION_WILLOW`, `TIKTOK_SESSION_MAGGIE`, `TIKTOK_SESSION_MARS`
- **TikTok profiles:** `TIKTOK_PROFILE_MAIN`, `TIKTOK_PROFILE_WILLOW`, `TIKTOK_PROFILE_MAGGIE`, `TIKTOK_PROFILE_MARS`
- **Alt emails:** `ALT_TIKTOK_EMAIL_1`, `ALT_TIKTOK_EMAIL_2`, `ALT_TIKTOK_EMAIL_3`
- **Internal / Maggie:** `MAGS_ASSISTANT_TOKEN`, `POST_THREAD_SECRET`, `SECRET_BLOB`
- **Google integrations:** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_GEOCODING_API_KEY`
- **OpenAI / Gemini:** `OPENAI_API_KEY`, `CODEX_AUTH_TOKEN`
- **Browserless:** `BROWSERLESS_API_KEY`, `BROWSERLESS_BASE_URL`, plus runtime use of `BROWSERLESS_API_URL`, `BROWSERLESS_TOKEN`
- **GitHub:** `GITHUB_TOKEN`, `GITHUB_PAT`
- **Cloudflare:** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_KV_POSTQ_NAMESPACE_ID`, `CLOUDFLARE_KV_POSTQ_HUMAN_NAME`
- **Vercel:** `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`
- **Worker URL:** `WORKER_URL`
- **Apps Script:** `APPS_SCRIPT_WEBAPP_URL`, `APPS_SCRIPT_DEPLOYMENT_ID`, `APPS_SCRIPT_SCRIPT_ID`, `APPS_SCRIPT_EXEC`
- **Flags:** `USE_CAPCUT`, `CAPCUT_TEMPLATE`, `CAPCUT_EXPORT_FOLDER`, `CAPCUT_RAW_FOLDER`, `MAGGIE_LOG_TO_CONSOLE`
- **Backups / misc:** `FETCH_PASS`, `PASS_WORD`, `WORKER_CRON_KEY`, `ADMIN_KEY`

## KV Namespaces & Keys

- **BRAIN** – bound in `wrangler.toml`; primary KV namespace for the worker.
- **thread-state** – default key read from the `POSTQ` namespace (aliased through `SECRET_BLOB` if present) to hydrate config.
- **config:brain** – used by the `brain/` utilities to sync human configuration/memory.

## Existing Tally / Stripe / Notion / Drive Code

- **Tally:** various docs (`docs/tally-*.md`), scripts (`scripts/tally-webhook-register.mjs`, `scripts/tally-backfill.mjs`), and a test page under `check/index.html`.
- **Stripe:** UI components (`components/SyncStripeButton.tsx`), environment helpers (`lib/env.js`), docs (`docs/stripe-sync.md`).
- **Notion:** components for task/note management (`components/MagsNotionPanel.jsx`, `components/MagsHQPanel.jsx`), and Google Apps Script integration (`integrations/google_sheets/auto_clean_and_forward.gs`).
- **Drive:** Google Drive usage in Apps Script (`integrations/google_sheets/auto_clean_and_forward.gs`) and environment helpers (`lib/env.js`).

## Site UI (Pages)

A minimal Vite + React app exists under `/ui` with:
- `index` page providing a simple chat interface.
- `/browser` page creating a Browserless session.

No public marketing pages, offerings, intake flow, or download pages are currently implemented. Additional Pages routes and styles will need to be built.

