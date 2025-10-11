# Soul reading fulfillment status

## Stripe entry point
- **Wired:** `/api/stripe/webhook` verifies the Stripe signature, extracts each checkout line item with reading metadata, and calls `triggerReading` for every qualifying item. 【F:app/api/stripe/webhook/route.ts†L1-L78】
- **Gaps:** Only `checkout.session.completed` is handled today. Subscription renewals or invoice events are still TODO inside the trigger helper. 【F:lib/stripe/reading.ts†L286-L329】

## Fulfillment trigger helper
- **Wired:** `triggerReading` loads Gmail/Drive/Resend/Notion secrets from KV/thread config, calls `runOrder({ kind: 'stripe-session', sessionId })`, and syncs the fulfillment "brain" log once delivery succeeds. 【F:lib/stripe/reading.ts†L64-L220】【F:lib/stripe/reading.ts†L300-L329】
- **Gaps:** Add-on line items are only logged; there is no branching behavior (e.g., bundling add-ons into an existing order). Subscription-triggered reruns remain unimplemented. 【F:lib/stripe/reading.ts†L303-L329】

## Intake normalization
- **Wired:** `normalizeFromStripe` reloads the checkout session, maps price/product IDs through `config/sku-map.json`, infers fulfillment type/add-ons, and queues a missing-info email if birth data or email is missing. 【F:src/fulfillment/intake.ts†L294-L377】【F:config/sku-map.json†L1-L15】
- **Wired:** `normalizeFromTally` parses form submissions, carries through tier hints, and runs through the same add-on + fulfillment detection logic. 【F:src/fulfillment/intake.ts†L467-L544】
- **Gaps:** Intake relies on up-to-date SKU metadata; adding new Stripe products still requires manual entries in `config/sku-map.json`. 【F:config/sku-map.json†L1-L15】

## Tally form webhook
- **Wired:** `/api/webhook/tally` validates the signature, logs raw payloads, normalizes the intake, and runs the same `runOrder` pipeline whenever birth data + tier are present. 【F:app/api/webhook/tally/route.ts†L93-L176】
- **Gaps:** Submissions missing key soul data are only logged; there is no automated reminder beyond the intake email fired during normalization. 【F:src/fulfillment/intake.ts†L362-L375】【F:app/api/webhook/tally/route.ts†L147-L163】

## Pipeline runner
- **Wired:** `runOrder` resolves the intake (Stripe session, Tally payload, or direct object), creates a Drive workspace, generates the blueprint doc + PDF, assembles the icon bundle, produces schedule PDFs, emails the customer, and logs to Sheets/Notion/KV. 【F:src/fulfillment/runner.ts†L66-L194】
- **Gaps:** Telegram notifications rely on a stub sender that only logs to stdout; real bot credentials must be wired before operators receive chat pings. 【F:src/fulfillment/deliver.ts†L177-L187】【F:src/lib/telegram.ts†L1-L5】

## Artifact generation
- **Blueprint:** Copies the Google Doc template (or creates one), injects the generated story, exports a PDF, and stores everything under `Fulfillment/{email}/{date}/blueprint`. 【F:src/fulfillment/blueprint.ts†L320-L384】
- **Icons:** Reuses Drive library assets when available, otherwise renders SVG placeholders, writes a manifest, and persists bundle metadata for reuse. 【F:src/fulfillment/icons.ts†L60-L204】
- **Schedule:** Builds daily/weekly/monthly docs (tier-based), exports PDFs, and saves them beside the order workspace. 【F:src/fulfillment/schedule.ts†L1-L132】
- **Status:** All three generators operate against live Google APIs; no placeholder artifacts remain.

## Delivery & logging
- **Wired:** Email delivery prefers Gmail API and falls back to Resend, capturing Drive links for docs, PDFs, icons, and schedules. Summaries append to Sheets, update Notion, and persist the last-run snapshot. 【F:src/fulfillment/deliver.ts†L1-L188】【F:src/fulfillment/runner.ts†L139-L194】
- **Gaps:** Telegram alerts (ops notifications) are console-only today; replacing `tgSend` with a real bot client is needed for on-call awareness. 【F:src/lib/telegram.ts†L1-L5】

## Overall next steps
1. Implement subscription/invoice handling inside `triggerReading` so renewals trigger the same pipeline. 【F:lib/stripe/reading.ts†L286-L329】
2. Decide how add-on-only line items should behave (e.g., merge into an existing session versus creating a parallel fulfillment). 【F:lib/stripe/reading.ts†L303-L329】
3. Replace the Telegram stub with a real sender so ops alerts fire outside of logs. 【F:src/lib/telegram.ts†L1-L5】
4. Keep `config/sku-map.json` current as new Stripe products/price IDs are launched. 【F:config/sku-map.json†L1-L15】
