@codex

Goal
Give me a single place in Notion where I can type natural-language commands and Maggie executes them (Stripe updates, Notion building, DALL·E image generation, RPA/browser steps). Also keep syncing my “Stripe Product Tracker – Active” DB.

Environment (already set in Vercel)
- NOTION_TOKEN
- NOTION_HQ_PAGE_ID
- NOTION_STRIPE_DB_ID  ← database ID of “Stripe Product Tracker – Active”
- STRIPE_SECRET_KEY
- BROWSERLESS_TOKEN
- CRON_SECRET

Build

A) Notion “Command Center”
1) Create (or ensure) a Notion database under NOTION_HQ_PAGE_ID titled **“Maggie Command Center”** with properties:
   - Command (title)
   - Arguments (rich_text)
   - Status (select: Pending, Running, Succeeded, Failed)
   - Output / Logs (rich_text)
   - Created (created_time)
   - Updated (last_edited_time)
   - Run Now (checkbox)
2) Add an API route: **POST /api/commands/run**
   - If body has {id} → run that Command row by ID.
   - If body has {command, args} → create a row then run it.
   - Respond JSON with {ok, id, status}.

B) Executor (natural-language → actions)
Create **lib/executor.ts** that routes common intents from “Command” to handlers:
   - **stripe.syncFromTracker** → reads NOTION_STRIPE_DB_ID rows and:
     * creates/updates Stripe Products & Prices
     * uploads image from Notion file property or fallback from “MM Stripe Images”
     * sets tax_behavior=exclusive, metadata (slug, tier, donation flags)
     * returns a summary table to Output / Logs
   - **notion.createTable** → creates a full-page Notion DB with given columns (e.g., “Create a Content Calendar with columns Title, Topic, Due Date, Platform, Status”)
   - **notion.appendPage** → creates a page, sets icon/cover, writes content blocks
   - **images.generate** → calls OpenAI Images/DALL·E using product reference images in Notion to match aesthetic; saves result back to Notion file property
   - **rpa.openAndClick** → uses Browserless to open a URL and perform a short script (login flow or one-off steps); save a viewer URL in Output / Logs
Implement a simple intent detector (regex / keywords). Log “Couldn’t route” when unknown.

C) Poller + buttons
1) API: **POST /api/commands/scan** (protected by x-mags-key: CRON_SECRET)
   - Finds Command Center rows where (Run Now=true OR Status=Pending), marks Status=Running, executes, writes Output/Logs, then sets Succeeded/Failed.
2) GitHub Action “mags-cron”:
   - Add a step to call /api/commands/scan every 2–5 minutes on schedule and via workflow_dispatch.
3) Small web UI:
   - Add a simple page at **/console** with a textbox (Command, Args), a “Run” button that POSTs to /api/commands/run, and a link to last 10 logs.

D) Stripe Tracker integration
- API: **POST /api/stripe/sync** (X-Worker-Key protected). This uses NOTION_STRIPE_DB_ID as source of truth:
  * expects columns: Product Name (title), Status (select), Price (number), Product Description (text), Image File (files), Stripe Link (url, optional)
  * when product created/updated, write Stripe Link and flip Status → “Added in Stripe”; set Date Updated = today (if column exists)
  * idempotent by slug derived from Product Name (kebab-case)

E) README
- Add “How to talk to Maggie” section with examples (see below).
- Add curl examples:
  curl -s -X POST "$API_BASE/api/commands/run" -H "content-type: application/json" -d '{"command":"stripe.syncFromTracker"}'
  curl -s -X POST "$API_BASE/api/commands/scan" -H "x-mags-key: '"$CRON_SECRET"'"

Deliverables
- New Notion DB creation, routes, executor, cron wiring, /console page
- Logs shown in Output / Logs and in server logs
- Safe, idempotent Stripe updates

Examples I will use
- “stripe.syncFromTracker”
- “Create a Notion table named ‘Content Calendar’ with columns Title (title), Topic (text), Due Date (date), Platform (select: TikTok, IG, YT), Status (select: Idea, Script, Record, Edit, Scheduled, Posted)”
- “Generate a pastel cottagecore product cover for ‘Full Soul Blueprint’ using the reference image in Stripe Tracker row; attach back to Image File”
- “Open Stripe login and wait; return the viewer link”
