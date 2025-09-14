# Stripe Audit

Nightly job verifying Stripe products and donate button health.

## What it checks
- Lists active Stripe products and their prices.
- Ensures each product has an active price and a currency.
- Cross-checks donate button amounts and price IDs on the live site.
- Optionally posts a Telegram summary.

## How to run
1. Go to **Actions → Stripe Audit**.
2. Click **Run workflow** to start a manual run.

## Secrets
- `STRIPE_SECRET_KEY`
- `PROD_URL`
- optional: `OPENAI_API_KEY`
- optional: `TELEGRAM_BOT_TOKEN`
- optional: `TELEGRAM_CHAT_ID`

## Exit codes
- `0` – no issues.
- `78` – warnings only (e.g., unused prices).
- `1` – errors (missing active price, currency mismatch, broken link, etc.).

## Output
The workflow uploads `stripe_audit.json` as an artifact containing the full report.
