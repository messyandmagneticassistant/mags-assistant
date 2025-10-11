# Soul Reading Automation Audit

## Overview
This document captures the current state of the soul reading automation that should run after a Stripe checkout session completes. It highlights what is wired up, what still depends on external Make.com flows, and where follow-up work is needed.

## Findings

### 1. Stripe webhook → internal trigger
- `app/api/stripe/webhook/route.ts` still posts payloads to whatever URL is stored in `MAKE_SOUL_READING_WEBHOOK_URL` via `triggerReading(...)`, so the Next.js app is *not* invoking the internal fulfillment pipeline yet. 【F:app/api/stripe/webhook/route.ts†L1-L74】【F:lib/stripe/reading.ts†L1-L46】
- A newer webhook lives at `app/api/webhook/stripe/route.ts` that *does* call `runOrder({ kind: 'stripe-session', ... })`, but Stripe would have to be reconfigured to point at `/api/webhook/stripe` for that flow to run. 【F:app/api/webhook/stripe/route.ts†L1-L86】

**Recommendation:** swap the webhook target (or update `triggerReading`) to call `runOrder`/`enqueueFulfillmentJob` directly so the internal pipeline runs without Make.

### 2. Reading tier metadata
- `buildReadingPayloads` infers the tier from Stripe price/product metadata and includes it in the webhook payload. 【F:lib/stripe/buildReadingPayloads.ts†L1-L119】
- The intake normalization used by the internal runner (`normalizeFromStripe`) also maps tiers/add-ons from SKU metadata, so once the internal handler is active the correct tier will flow through. 【F:src/fulfillment/intake.ts†L210-L314】

### 3. Reading generation artifacts
- `generateBlueprint` assembles the Google Doc/PDF story inside the fulfillment workspace, exports a PDF, and returns Drive links. 【F:src/fulfillment/blueprint.ts†L320-L382】
- The runner also builds icon bundles and rhythm schedules before delivery. 【F:src/fulfillment/runner.ts†L52-L109】

### 4. Delivery & logging
- Email delivery is handled in `deliverFulfillment` using Gmail first, falling back to Resend, and optionally posting to Telegram. No SMS/Text delivery exists today. 【F:src/fulfillment/deliver.ts†L1-L154】
- Successful runs append to the Google Sheet log, optionally create a Notion page, update status files, and record summaries. Failures retry once, then log and alert. 【F:src/fulfillment/runner.ts†L80-L151】【F:src/fulfillment/common.ts†L200-L247】

### 5. Bundle/add-on handling
- `normalizeFromStripe` pulls SKU mappings from `config/sku-map.json`, detects add-ons (magnet kits, extra icons, bonus systems), figures out fulfillment type (digital/physical/cricut), and captures household info where available. 【F:src/fulfillment/intake.ts†L1-L367】【F:config/sku-map.json†L1-L15】

### 6. External webhooks (Make.com)
- The legacy path still depends on `MAKE_SOUL_READING_WEBHOOK_URL`. No alternate internal handler is referenced inside `triggerReading`. 【F:lib/stripe/reading.ts†L16-L46】

### 7. Failure visibility
- The legacy webhook only logs to `console.error` on failures, so misfires can silently disappear in production without operator alerts. 【F:app/api/stripe/webhook/route.ts†L40-L74】
- The internal runner’s error handling is much richer (Sheets + Telegram), reinforcing the need to migrate traffic to it. 【F:src/fulfillment/runner.ts†L116-L151】

## Next Steps
1. Point the Stripe webhook to `/api/webhook/stripe` (or refactor `triggerReading`) so we stop relying on Make.
2. Remove the Make.com dependency once traffic is migrated, or keep it as a fallback with explicit monitoring.
3. Confirm Gmail/Resend credentials plus Notion/Sheet IDs are present in production so delivery/logging succeed.
4. Backfill any missing tier mappings in `config/sku-map.json` (e.g., realignment tier) before cutting over fully.

