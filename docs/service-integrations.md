# Maggie Service Integrations

This checklist summarizes which external services are wired today and where the canonical implementations live.

## Messaging & Command Surface
- ✅ **Telegram webhook + commands** — `mags-runner/src/handlers/telegram.ts` forwards messages to Maggie's intent router, and `/status` or `/maggie-status` now returns a live task summary via `maggie/intent-router.ts` + `maggie/status.ts`. 【F:mags-runner/src/handlers/telegram.ts†L1-L29】【F:maggie/intent-router.ts†L1-L33】【F:maggie/status.ts†L1-L82】

## Intake & Webhooks
- ✅ **Tally** — incoming submissions are verified and stored before fulfillment in `worker/orders/tally.ts`. 【F:worker/orders/tally.ts†L1-L55】
- ✅ **Stripe → Notion** — the Next.js webhook handler signs Stripe events, syncs donors into Notion, and optionally triggers Telegram alerts. 【F:app/api/stripe/webhook/route.ts†L1-L86】
- ✅ **Notion status logging** — blueprint deliveries and donor flows both add rows to Notion databases. 【F:worker/routes/blueprint.ts†L21-L53】【F:app/api/stripe/webhook/route.ts†L46-L75】

## Blueprint & Magnet Pipeline
- ✅ **Form-based blueprint generation** — the worker blueprint route invokes Apps Script, emails via Resend, and records delivery metadata. 【F:worker/routes/blueprint.ts†L1-L53】
- ✅ **Icon & magnet generation helpers** — quiz submissions build icon bundles and magnet kits using presets. 【F:content/loader/blueprint.ts†L1-L74】【F:lib/magnet-kit.ts†L1-L31】【F:app/api/quiz/submit/route.ts†L1-L35】
- ✅ **Rhythm tier routing** — quiz metadata is mapped to the correct product tier and magnet format in `quiz/router.ts`. 【F:quiz/router.ts†L1-L75】

## Automation & Delivery
- ✅ **Browserless / Puppeteer triggers** — `/api/browser/session` creates Browserless sessions with project tokens. 【F:worker/routes/browser.ts†L1-L20】
- ✅ **Email + Drive delivery** — blueprint generation sends PDFs via Resend and relies on Apps Script/Drive for storage. 【F:worker/routes/blueprint.ts†L9-L53】
- ✅ **Operational tracking** — donor and blueprint flows persist status in Notion while queue state is mirrored to KV. 【F:worker/routes/donors.ts†L1-L34】【F:worker/orders/tally.ts†L32-L51】

## KV & Brain Sync
- ✅ **Nightly brain + thread-state sync** — the GitHub Action refreshes `config/kv-state.json` timestamps and the worker cron backfills `thread-state` from GitHub (`chore/nightly-brain-sync` fallback to `main`). 【F:.github/workflows/sync-brain.yml†L1-L118】【F:scripts/brainPing.ts†L1-L94】【F:worker/lib/threadStateSync.ts†L1-L120】【F:worker/worker.ts†L317-L357】

If a new integration is needed, this document should be extended with the entry point once the code ships.
