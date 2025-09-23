# Mags Assistant

[![CF deploy](https://github.com/messy-and-magnetic/mags-assistant/actions/workflows/cf-ai.yml/badge.svg)](https://github.com/messy-and-magnetic/mags-assistant/actions/workflows/cf-ai.yml)

Maggie now auto-cleans small pellet-like blobs on all floor types.
She saves a short proof preview (before/after side-by-side) in content/preview/ for 7 days, then auto-deletes them to keep storage clean.

## Docs
- [Inventory](docs/INVENTORY.md)
- [Quickstart](docs/QUICKSTART.md)

## Mobile control

Use the private Telegram bot to run Maggie without opening GitHub:

- `/start-sync` seeds Cloudflare KV with the latest brain payload, verifies `/diag/config`, and logs the run to Google Sheets.
- `/maggie-status` reports the most recent brain sync, worker `/health`, recent task log entries, and any errors from the past 24 hours.
- `/maggie-help` lists all supported chat commands.
- `/status` checks Worker health, Browserless credentials, and TikTok session coverage from Telegram.
- `/publish-site` deploys everything in `site/` directly to the Cloudflare Worker routes for `messyandmagnetic.com` and `assistant.messyandmagnetic.com`.
- `/self-heal` restarts Browserless/Puppeteer flows and verifies TikTok sessions, reporting the results back to chat.

Run `npx tsx scripts/runTelegram.ts` on a box with secrets loaded to keep the Telegram bridge online.

## Automation loops

- `scripts/publishSite.ts` publishes static HTML/CSS/JS from `site/` into Cloudflare KV and logs each deploy to Telegram.
- `scripts/selfHeal.ts` retries Browserless, Puppeteer, and TikTok session health checks, sending a consolidated report.
- `scripts/runMaggie.ts` orchestrates the social loop (TikTok boosters + Browserless warmup) and posts a summary to Telegram. GitHub Action **Social Loop** (`.github/workflows/social-loop.yml`) runs every two hours and on manual dispatch to execute this script.

### Pellet Cleaner
Run `pnpm run clean:pellets` to nuke local node_modules and .pnpm-store, prune old packages, and reinstall fresh.
Useful if installs are failing or local deps look corrupted.


## Pellet Clean Previews

Run the pellet cleaner in CI to generate proof clips:

1. Go to **Actions → Pellet Clean Previews → Run workflow**.
2. Adjust `target_glob` and `max_previews` as needed.
3. Download the `pellet-clean-previews` artifact for results.

This step is optional and won't fail your main build.

Production domain: https://mags-assistant.vercel.app

If the GitHub deploy ever fails, run `npx wrangler deploy` locally as a fallback.

## How to run the UI locally

```sh
cd ui
pnpm install
pnpm dev
```

Visit <http://localhost:5173> to chat with the Worker or open a Browserless session.

## How to use Browserless session

Create a new session via the Worker and receive a WebSocket URL:

```sh
curl -X POST https://maggie.messyandmagnetic.com/api/browser/session
```

## Secrets

Source of truth for secrets lives in Cloudflare KV (`secrets.json`).
Vercel should hold only minimal routing vars such as
`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `WORKER_BASE_URL` (or `WORKER_URL`),
`CLOUDFLARE_KV_NAMESPACE_ID`, `NEXT_PUBLIC_SITE_URL`, and any
`NEXT_PUBLIC_*` or `EDGE_CONFIG` values referenced by the app.
Never commit plaintext secrets.

## Config

Runtime config lives in the worker's KV store and is accessed through the
`getConfig(scope)` helper. Example:

```ts
import { getConfig } from './utils/config';

const brain = await getConfig('brain');
```

To write updates, merge your changes and POST them back to the worker's
`/config` route:

```sh
curl -X POST "$WORKER_URL/config?scope=brain" \
  -H "Authorization: Bearer $WORKER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"foo":"bar"}'
```

See `lib/updateBrain.ts` for a programmatic example.

## Action Secrets

Run [Secrets Sanity](.github/workflows/secrets-sanity.yml) to post a checklist of required GitHub Action secrets.

| Secret | Where to find it |
| --- | --- |
| `BROWSERLESS_WS` | Browserless dashboard → Websocket Endpoint |
| `GH_PAT` (optional; scopes: repo, workflow) | GitHub → Settings → Developer settings → Personal access tokens (classic) |
| `VERCEL_TOKEN` | Vercel dashboard → Account Settings → Tokens |
| `VERCEL_ORG_ID` | Vercel dashboard → Project → Settings → General → “ID” |
| `VERCEL_PROJECT_ID` | Vercel dashboard → Project → Settings → General → “Project ID” |
| `VERCEL_API_KEY` | Vercel dashboard → Account Settings → Tokens |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Account Home → Overview |
| `CLOUDFLARE_KV_NAMESPACE_ID` | Cloudflare dashboard → Workers & Pages → KV → your namespace → Namespace ID |

## Secrets sync (Vercel → Cloudflare KV)

Syncs selected Vercel project environment variables into Cloudflare KV under the key `SECRETS_JSON`.

Required GitHub secrets:

- `VERCEL_API_KEY`
- `VERCEL_PROJECT_ID`
- `CF_ACCOUNT_ID`
- `CF_API_TOKEN`
- `CLOUDFLARE_KV_NAMESPACE_ID`

Run locally:

```sh
VERCEL_API_KEY=... VERCEL_PROJECT_ID=... CF_ACCOUNT_ID=... CF_API_TOKEN=... CLOUDFLARE_KV_NAMESPACE_ID=... npm run sync:secrets
```

## Secrets sync (Cloudflare KV → Vercel)

Pulls a JSON object from Cloudflare KV (key `SECRETS_JSON`) and syncs the keys into the Vercel project.

GitHub → Actions → **Secrets: Sync Cloudflare KV -> Vercel**

- First run with `apply=false` to preview changes.
- Re-run with `apply=true` to create/update/delete vars in Vercel.

## Prune Vercel Env Vars

GitHub → Actions → **Vercel: Prune Env Vars**
- Dry run (default): shows what would be deleted
- Run with 'apply: true' to actually delete

## GitHub Pages

The marketing site for Messy & Magnetic lives at https://messyandmagnetic.github.io and is served from the `main` branch. Static assets live in `/assets` and styles in `/styles`. Custom domain `messyandmagnetic.com` is configured via Cloudflare with a CNAME record for `www`, A records for `@`, SSL, and a redirect rule sending `www` to the root domain.

Test links:

- https://mags-assistant.vercel.app/ — landing page
- https://mags-assistant.vercel.app/watch — viewer page
- https://mags-assistant.vercel.app/hello
- https://mags-assistant.vercel.app/diag
- https://mags-assistant.vercel.app/health
- https://mags-assistant.vercel.app/console — simple command console
- https://mags-assistant.vercel.app/chat — chat page
- https://mags-assistant.vercel.app/studio — studio page
- https://mags-assistant.vercel.app/planner — planner page
- https://mags-assistant.vercel.app/check — system check panel

## Brain sources

Pinned Notion pages for periodic sync:

- https://www.notion.so/MM-Site-Content-24a796c707c1808d8e59fb5b792e0fb8
- https://www.notion.so/Mags-Task-Manager-24b796c707c18018a017c7b267a6bf61

Add more by editing `public/mags-config.json` under `brain.sources.notion.pinned`.

## API map

- `POST /api/ops?action=status` – list present env vars
- `POST /api/ops?action=check` – simple health ping
- `POST /api/stripe-webhook` – Stripe events (rewrite to `/api/ops?action=stripe-webhook`)

Env vars:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_FETCH_PASS` (optional)

### Maggie Redeploy Endpoint
POST /api/redeploy
body: { owner, repo, workflow_file?, ref?, reason? }
Triggers GitHub Actions workflow_dispatch to redeploy Production on Vercel.
Requires env: GITHUB_REDEPLOY_TOKEN (repo-scoped, Actions: Read & Write)
Optional: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID for notifications.

## Worker testing

```sh
curl -i -X POST -H "X-Fetch-Pass: $FETCH_PASS" https://maggie-worker.messyandmagnetic.workers.dev/land/scan
curl -i -X POST -H "X-Fetch-Pass: $FETCH_PASS" https://maggie-worker.messyandmagnetic.workers.dev/land/summary
curl -i -X POST -H "X-Fetch-Pass: $FETCH_PASS" https://maggie-worker.messyandmagnetic.workers.dev/ai/draft-reply \
  -d '{"thread":{"from":"Donor","summary":"Interested in conservation work","goal":"Secure pledge"}}' -H "Content-Type: application/json"
```

## Tally → Sheets pipeline

Apps Script Web App URL is stored as `GAS_INTAKE_URL` (GitHub secret and Worker secret). Optional `TALLY_WEBHOOK_SECRET` enables HMAC verification of incoming payloads.

Where to point Tally webhooks:

- Preferred: Tally → Worker → `GAS_INTAKE_URL` (forwards raw body + headers)
- Direct: Tally → `GAS_INTAKE_URL` (disable Worker forwarding to avoid double writes)

**Tally → Worker (fan-out) is the only active integration path.** Leave the Worker webhook enabled and disable Tally's direct Google Sheets or Notion integrations. See [docs/tally-wiring.md](docs/tally-wiring.md) for setup notes.

Backfill: provide `TALLY_API_KEY` and run the **Backfill Tally** sheet menu or trigger the `tally-backfill` GitHub Action.

Docs: [Apps Script deploy](docs/apps-script-deploy.md) · [Sheet details](docs/tally-sheets.md) · [Curl tests](docs/tally-tests.md)

### Smoke tests

The `smoke` GitHub Action checks the worker `/health` endpoint and posts synthetic payloads to `/tally-intake`. View logs in the Actions tab and re-run the workflow as needed.

### Cloudflare Cron

Example schedules (configure in Cloudflare Dashboard):

```
# daily digest at 09:00 UTC
0 9 * * * https://maggie-worker.messyandmagnetic.workers.dev/ops/digest
# weekly land summary every Monday at 08:00 UTC
0 8 * * 1 https://maggie-worker.messyandmagnetic.workers.dev/land/summary
```

Example curl for /start:

```sh
curl -X POST 'https://mags-assistant.vercel.app/api/rpa?action=start' \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

## Scraper

Set `SCRAPER_PROVIDER` to choose a scraping backend (defaults to `actions`).
If an external provider requires credentials, supply `SCRAPER_API_KEY` and `SCRAPER_ENDPOINT`.

## Chat UI

The `/chat` interface requires the following environment variables:

- `OPENAI_API_KEY` – API key for OpenAI requests.
- `CHAT_PASSWORD` – optional password protecting the chat. If unset, the page warns that auth is disabled.
- `NOTION_TOKEN` – token for Notion API access.
- `NOTION_HQ_PAGE_ID` – Notion HQ page ID.
- `NOTION_QUEUE_DB` – Notion queue database ID.
- `PRODUCTS_DB_ID` – Notion database ID for Stripe products.
- `DONOR_DB_ID` – Notion database ID for donor tracking.
- `OUTREACH_DB_ID` – Notion database ID for outreach tracking.
- `CONTENT_DB_ID` – Notion database ID for content planning.
- `STRIPE_SECRET_KEY` – Stripe API key.
- `RESEND_API_KEY` – optional; API key for sending email notifications.
- `NOTIFY_EMAIL` – optional email address for notifications.
- `NOTIFY_WEBHOOK` – optional webhook for outgoing notifications.
- `BRAND_PRIMARY_HEX` – optional primary color override.
- `BRAND_SECONDARY_HEX` – optional secondary color override.
- `TELEGRAM_BOT_TOKEN` – optional; token for Telegram bot notifications.
- `TELEGRAM_CHAT_ID` – optional; target chat for Telegram notifications.
- `APPROVAL_MODE` – optional; set `strict`, `normal`, or `auto` for message approvals.

## Notifications & Telegram

Configure optional outbound notifications.

- Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to enable Telegram messages.
- Optionally define `RESEND_API_KEY` and `NOTIFY_EMAIL` for email alerts or `NOTIFY_WEBHOOK` for custom webhooks.
- Send notifications via `POST /api/notify`.
- Telegram webhook URL: https://assistant.messyandmagnetic.com/api/telegram
- Approval webhook: https://assistant.messyandmagnetic.com/api/approve

### Telegram approvals

Proposal notifications include inline **Approve/Decline** buttons.
Button presses send `{actionId, runId, kind}` to `/api/approve` which
invokes the relevant worker (`sendOutreach`, schedules a follow-up, or
marks content approved). Declines mark the run as **Rejected**.

## Scheduled Tasks (free)
We run a free scheduler using GitHub Actions that calls `/api/cron/tick` every 15 minutes.

### Configure
- Vercel env:
  - NOTION_TOKEN = <internal integration token>
  - NOTION_ROOT_PAGE_ID = <the HQ page id>
  - (optional) CRON_SECRET = <random string>
- GitHub Repo → Settings → Secrets and variables → Actions:
  - NOTION_TOKEN / NOTION_ROOT_PAGE_ID / CRON_SECRET (match Vercel)

### Endpoints
- GET /api/notion/diag      → verifies Notion connectivity
- GET /api/cron/tick?dry=1  → shows which tasks would run
- GET /api/cron/tick        → runs all tasks
- GET /api/cron/tick?only=notion.sync_hq&only=social.refresh_planner  → run subset

### Add your own tasks
Create a file in `apps/api/lib/tasks/your-task.ts` that exports `async function myTask()`.
Add it to `tasks` in `apps/api/lib/tasks/index.ts` with a unique key.

## Scheduler

Automated jobs are processed by a GitHub Actions workflow located at `.github/workflows/cron-runner.yml`.

- **Manual trigger:** Open the [Actions page](https://github.com/messyandmagnetic/mags-assistant/actions), select `mags-cron`, and choose "Run workflow".
- **Required secrets:** `API_BASE`, `WORKER_KEY`, `NOTION_TOKEN`, `NOTION_PAGE_ID`, `OPENAI_API_KEY`, and optional email alerts `ALERT_EMAIL_USER`, `ALERT_EMAIL_PASS`, `ALERT_TO`.
- **Change schedule:** edit the cron expression under `on.schedule` in the workflow file.
- **Endpoints:** the runner claims jobs from `/api/queue/claim`, runs them via `/api/queue/run`, and marks them done with `/api/queue/complete`.

The current schedule runs every 10 minutes.

## Maggie Job Queue

Automated jobs for Maggie are tracked in a Notion database named **Maggie Job Queue** under the HQ page.

### Required environment variables

- `NOTION_TOKEN` – Notion internal integration token
- `NOTION_HQ_PAGE_ID` – parent page where the queue database lives
- `NOTION_QUEUE_DB` – database ID of "Maggie Job Queue" (created on first seed)

### Reseed

To recreate the database and seed the initial job, call:

```sh
curl -X POST "$API_BASE/api/queue/seed" -H "x-mags-key: $CRON_SECRET"
```

## Fallback Ops

Manual Stripe/Notion tasks can run via GitHub Actions when Mags is offline.

### Required secrets
Set these in Repo → Settings → Secrets and variables → Actions:
- `NOTION_TOKEN` – internal Notion integration
- `PRODUCTS_DB_ID` – ID of the "Stripe Product Tracker" database
- `STRIPE_SECRET_KEY`
- optional: `RESEND_API_KEY`, `NOTIFY_EMAIL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

### Run
1. Open **GitHub → Actions** and select **mags-ops-fallback**.
2. Click **Run workflow**.
3. Choose a task (e.g. `sync-stripe-from-notion`) and start with **Dry run** = true.
4. Inspect the logs, then re-run with **Dry run** = false to apply changes.

## Unread badge

`GET /api/chat/unread` returns `{ count }`. The header and dashboard poll this endpoint every 30s and show a red badge on the Chat link when the count is greater than zero. Opening `/chat` clears the count.

## Planner

The planner at `/planner` shows queued, running, and completed jobs from Notion.

## Studio

The video studio at `/studio` trims clips and exports MP4 or SRT files.

## Research

_(coming soon)_

## Memory

_(coming soon)_

## Email triage

_(coming soon)_

## Grant pack

_(coming soon)_

## Stripe ↔ Notion sync

Endpoint: `/api/stripe/sync`

Modes:

- `mode=audit&dry=1` — report differences without changes.
- `mode=full&dry=0` — audit and apply fixes.

Environment variables:

- `STRIPE_SECRET_KEY`
- `NOTION_TOKEN`
- `PRODUCTS_DB_ID`
- optional: `RESEND_API_KEY`, `NOTIFY_EMAIL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

Donation products can be added like any other product; create a Notion row with `Type` = `Donation` and amount/tiers as needed.

## Notion Stripe schema

The Stripe products database enforces the following properties:

| Property | Type |
| --- | --- |
| Name | title |
| Description | rich_text |
| Type | select (one-time, recurring, donation) |
| Price | number |
| Currency | select |
| Interval | select (day, week, month, year) |
| Active | checkbox |
| Statement Descriptor | rich_text |
| Tax Behavior | select (inclusive, exclusive, unspecified) |
| Tax Code | rich_text |
| Metadata | rich_text |
| Image Folder | rich_text |
| Stripe Product ID | rich_text |
| Stripe Price ID | rich_text |
| Date Updated | date |
| Status | select (To Do, In Progress, Ready to Add, Added in Stripe, Needs Edit) |

If a property exists with the wrong type, the old property is renamed with a `(legacy)` suffix and a new `(fixed)` property is created.

```sh
# Ensure database schema
curl -X POST "$API_BASE/api/notion/ensure-stripe-schema" \
  -H "X-Worker-Key: $WORKER_KEY"

# Backfill missing defaults
curl -X POST "$API_BASE/api/notion/backfill-defaults" \
  -H "X-Worker-Key: $WORKER_KEY"
```

## Content planner

_(coming soon)_

## Social drafts & trending sounds

Early support for generating short-form video drafts from a Google Drive inbox and scheduling with trending audio.

### Required environment variables

- `DRIVE_INBOX_FOLDER_ID` – Google Drive folder containing new media.
- `NOTION_CONTENT_DB_ID` – Notion database for the content queue.
- `OPENAI_API_KEY` – used for transcriptions and caption suggestions.
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` – send approval previews.
- `BROWSERLESS_KEY` – headless browser for TikTok/Instagram scheduling.
- `YT_CLIENT_ID` / `YT_CLIENT_SECRET` / `YT_REFRESH_TOKEN` – YouTube uploads.
- `TIKTOK_SESSION_COOKIE` – TikTok session with access to trending sounds.
- `IG_SESSION_COOKIE` – Instagram session for selecting trending audio.

## Google Sheets cleanup and forwarding

An Apps Script is provided in `integrations/google_sheets/auto_clean_and_forward.gs` to
back up, normalize and forward Google Form responses.

### Setup
1. Copy the script into a new Apps Script project or bind it to an existing spreadsheet.
2. Update `QUIZ_SHEET_ID` and `FEEDBACK_SHEET_ID` constants with your sheet IDs.
3. In **Project Settings → Script properties**, add:
   - `WORKER_URL` – endpoint to receive form submissions.
   - `NOTION_TOKEN` and `HQ_DATABASE_ID` (optional) to also log entries to Notion.
4. Run the `cleanAndBindAll` function to back up and clean both sheets.
   - Duplicate header rows are removed.
   - Empty rows/columns trimmed.
   - Headers normalized to `lower_snake_case` with a `timestamp` and `form_source` column.
5. The script installs an *On form submit* trigger that posts new rows to `WORKER_URL` and
   logs any errors to a sheet named `Error_Log`.

Minimal Vercel envs:
- WORKER_BASE_URL
- WORKER_KEY
- VERCEL_API_KEY
- VERCEL_PROJECT_ID


## Maggie Browser Loop

Trigger Maggie's browser mode without pnpm:

```bash
node scripts/run-maggie.js
```

This enables browser automation and forwards logs to Telegram and Notion.
