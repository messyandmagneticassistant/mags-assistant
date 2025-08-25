# MagsConnected Ops Status

The automation stack is tied to the Cloudflare Worker at:
`https://maggie-worker.messyandmagnetic.workers.dev`

## Queues
- `schedule-pack.json` tracks upcoming video drops and powers `/schedule.html` preview.

## Workflows
- `digest.yml` – daily Telegram summary via Worker `/digest/daily`.
- `gmail-sync.yml` – scans and summarizes grant/land outreach emails.
- `grants-scout.yml` – weekly NM grant lead search.
- `tally-cleanup.yml` – weekly Sheet header/dedupe/backfill.
- `stripe-audit.yml` – donation product validation.

## Required Secrets
`OPENAI_API_KEY`, `NOTION_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `WORKER_KEY`,
`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`
