# Fulfillment Pipeline

This module automates readings and rhythm kits from intake through delivery. It pulls context from Stripe checkout sessions or Tally quiz submissions, generates the soul blueprint story, assembles icon and schedule kits, delivers everything by email, and logs the run for operators.

## Flow Overview

1. **Intake normalization (`src/fulfillment/intake.ts`)**
   - `normalizeFromStripe(sessionId)` looks up the checkout session, maps Stripe price IDs to tiers and add-ons using `config/sku-map.json`, and extracts name + birth data from metadata. Missing essentials trigger a gentle follow-up email with the fallback intake form.
   - `normalizeFromTally(payload)` parses Tally submissions, aligns them with SKU mappings, and captures preferences plus household rhythm notes.
   - Both paths emit a unified object `{ customer, tier, addOns, prefs, email, source }` used by the rest of the pipeline.

2. **Blueprint generation (`src/fulfillment/blueprint.ts`)**
   - Creates/loads the order workspace in Drive under `/Fulfillment/{email}/{date}/`.
   - Builds a warm narrative using Codex first, retries once, then falls back to Claude and Gemini. Attempt metadata is stored on the result.
   - Copies the configured Google Docs template (or creates a blank doc), inserts the story, and exports a PDF alongside the doc. Both files live inside `/blueprint/` for the order.

3. **Icon bundle (`src/fulfillment/icons.ts`)**
   - Reads `config/icon-library.json` to reuse existing icons whenever possible.
   - For missing slots, generates a simple SVG icon aligned to the requested tone and saves it to `/icons/` in the Drive workspace.
   - Adds 2–3 "Write Your Own" blank magnets (up to 10 when configured) with dashed borders whenever the bundle's `include_blanks` toggle is enabled.
   - Produces a `manifest.json` that lists every icon, origin (library vs generated), and Drive links.

4. **Schedule kit (`src/fulfillment/schedule.ts`)**
   - Creates daily / weekly / monthly rhythm docs based on tier rules:
     - Mini → daily only
     - Lite → daily + weekly
     - Full → daily + weekly + monthly
   - Copies optional templates defined in `thread-state` or environment variables, otherwise builds docs from scratch.
   - Exports PDFs for each doc into `/schedule/`.

5. **Delivery (`src/fulfillment/deliver.ts`)**
   - Sends a human email via Resend/Zoho that links to the doc, PDF, schedule folder, and icon bundle (highlighting the included blank magnets). Tone stays warm and simple (no AI tells).

6. **Runner (`src/fulfillment/runner.ts`)**
   - `runOrder(orderRef)` orchestrates intake → blueprint → icons → schedule → deliver.
   - Logs to the Google Sheet tab `Fulfillment` (`UTC, Local, Email, Tier, BundleType, Files, Status`).
   - Updates the Notion orders database when credentials are available.
   - Records the last summary to disk/KV for `/ops/recent-order` and optional Telegram updates.
   - Retries the full pipeline once on error; final failure sends a Telegram alert via configured bot/chat.

## Queue & Webhooks

- `src/queue.ts` maintains a lightweight queue backed by KV with `queue.json` as local fallback. Jobs are `{ id, source, payload, attempts }`.
- `/webhooks/stripe` accepts `checkout.session.completed` events, verifies the webhook, and enqueues the session ID for processing.
- `/webhooks/tally` validates the Tally signature and enqueues the submission payload.
- `/ops/recent-order` returns the last processed order summary for quick operator or Telegram checks.

## Storage Layout in Drive

Each fulfillment run creates/uses:
```
/Fulfillment/{email}/{YYYY-MM-DD}/
  blueprint/
    Soul Blueprint (Google Doc)
    Soul Blueprint.pdf
  icons/
    *.png / *.svg
    manifest.json
  schedule/
    Daily rhythm doc + PDF
    Weekly rhythm doc + PDF (Lite/Full)
    Monthly cadence doc + PDF (Full)
```
Root folders, template IDs, and sheet/notion IDs can be defined in `thread-state` under the `fulfillment` section or via environment variables (`FULFILLMENT_*`).

## Fallback & Self-Heal Logic

- Story generation tries Codex → Claude → Gemini. Each provider gets one retry before moving to the next.
- If all providers fail, the runner logs to Sheets, records the error summary, and sends a Telegram alert.
- Missing intake essentials automatically trigger a friendly email pointing to the intake form.
- Queue state survives restarts via KV; the runner records the last success/failure so operators can poll `/ops/recent-order` without digging into logs.
