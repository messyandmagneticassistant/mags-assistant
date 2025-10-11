# Soul Reading Automation Audit

## Overview
This document captures the current state of the soul reading automation that should run after a Stripe checkout session completes. It highlights what is wired up, what still depends on external Make.com flows, and where follow-up work is needed.

## Findings

### 1. Stripe webhook → internal trigger
- `app/api/stripe/webhook/route.ts` now calls `triggerReading(...)` per qualifying line item, and that helper runs the full internal fulfillment pipeline (normalization → blueprint → icons → schedule → delivery/logging) instead of posting to Make.com. 【F:app/api/stripe/webhook/route.ts†L1-L74】【F:lib/stripe/reading.ts†L1-L187】
- Stripe payload metadata is still parsed via `buildReadingPayloads` and `normalizeFromStripe`, so add-ons and cohort details propagate into fulfillment. 【F:lib/stripe/buildReadingPayloads.ts†L1-L119】【F:src/fulfillment/intake.ts†L210-L367】

**Status:** Make.com webhook calls are fully deprecated for soul readings; the Next.js app invokes the internal runner directly.

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

### 6. Delivery & logging
- `triggerReading` loads Gmail/Resend/Notion/Sheets credentials from `getConfig()` + `.env`, so deliveries and operational logging stay online even if secrets come from KV. 【F:lib/stripe/reading.ts†L19-L165】
- `runOrder` now emits structured logs for each step (workspace prep, blueprint, icons, schedule, delivery, logging) to aid observability. 【F:src/fulfillment/runner.ts†L81-L130】
- Telegram alerts remain stubbed in local development; production credentials continue to pass through fulfillment config. 【F:src/lib/telegram.ts†L1-L5】【F:src/fulfillment/deliver.ts†L113-L146】

### 7. Post-fulfillment brain sync
- After successful delivery, `triggerReading` updates the brain document (primary KV + local log) so assistants see the latest fulfillment metadata. Failures are caught and logged without blocking delivery. 【F:lib/stripe/reading.ts†L167-L187】【F:lib/updateBrain.ts†L1-L180】
- Queue + KV summaries (`setLastOrderSummary`) still run after each order to feed dashboards and ops tooling. 【F:src/fulfillment/runner.ts†L107-L138】【F:src/queue.ts†L133-L162】

### 8. Failure visibility
- The webhook continues to bubble Stripe verification failures, while fulfillment retries once internally and surfaces errors via logs and Sheets. 【F:app/api/stripe/webhook/route.ts†L40-L74】【F:src/fulfillment/runner.ts†L133-L164】

## Next Steps
1. Monitor telemetry from the new logging to ensure blueprint/icon/schedule steps stay healthy under load.
2. Wire subscription renewals into the same fulfillment pipeline (currently TODO inside `triggerReading`).
3. Backfill any missing tier mappings in `config/sku-map.json` (e.g., realignment tier) before a full marketing push.

