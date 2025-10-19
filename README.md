# Maggie Assistant

Maggie is an autonomous full-stack AI agent that lives on Cloudflare Workers, keeps
state in KV, and drives Messy & Magnetic's production automations. The Worker
keeps schedulers warm, watches queues, pushes updates to Telegram, and syncs
stripe + Tally funnels with the rest of the stack.

## Quick overview
- **Brain + state** live in Cloudflare KV under the key `PostQ:thread-state`.
- **Worker runtime** bootstraps itself on every request and cron tick, loading
  Maggie's config before routing traffic.
- **Stripe, Telegram, Codex, Gemini, Browserless, Notion, and GitHub** are
  wired in via environment variables that Maggie reads from KV first, then
  falls back to Worker vars.
- **GitHub Actions** handle deployments and telemetry so Maggie keeps shipping
  without manual intervention.

## Local development
1. Install [Node.js 20+](https://nodejs.org/) and [pnpm 10+](https://pnpm.io/).
2. Clone the repo and install dependencies:
   ```bash
   pnpm install
   ```
3. Copy `.env.example` to `.env` (or export vars in your shell) and fill in the
   secrets you have available. Maggie will happily run with dummy keys for local
   smoke tests.
4. Start the Worker locally with Wrangler:
   ```bash
   pnpm wrangler dev --local
   ```
5. Hit [`http://127.0.0.1:8787/health`](http://127.0.0.1:8787/health) to make
   sure the Worker boots and returns a `200 OK` response.

> **Tip:** The Worker automatically hydrates config from the blob-based KV
> document before each request. Local `.env` vars win only when the KV binding
> is missing.

## Cloud deployment
1. Create a Cloudflare account and a Workers project.
2. Provision a KV namespace for Maggie's config and bind it as `PostQ` (or point
   `BRAIN` at the same namespace).
3. Seed the namespace with your config JSON under the key `PostQ:thread-state`.
   The scripts in `scripts/` contain examples (`seedKV.ts`, `updateBrain.ts`).
4. Add the following GitHub secrets so the deploy workflow can authenticate:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
   - `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID` (optional, for deploy alerts)
   - Any runtime secrets you do not store in KV yet (Stripe, Tally, etc.)
5. Push to `main`. The workflow at `.github/workflows/deploy.yml` installs
   dependencies, validates config with KV fallbacks, deploys via Wrangler, and
   pings Telegram when it succeeds (or fails).

## Blob-based KV config
Maggie's canonical configuration lives in the KV blob stored at
`PostQ:thread-state`. On every request the Worker:
1. Tries to read `PostQ:thread-state` from the `PostQ` (or `BRAIN`) namespace.
2. Merges those keys into the runtime `env` object.
3. If the blob is unavailable, falls back to environment variables so Maggie can
   still handle requests in a degraded mode.

The diagnostics route at `/diag/config` surfaces which keys were loaded and
where they came from without leaking the values themselves. This makes it easy
to confirm what Maggie sees at runtime when debugging.

## Environment variables
The project ships with a [`./.env.example`](./.env.example) file that lists all
known keys. Copy it to `.env` for local dev or use it as a checklist when
provisioning secrets in GitHub/Cloudflare. Highlights include:

- `STRIPE_KEY` / `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET`
- `TELEGRAM_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `GITHUB_PAT` or `GITHUB_TOKEN` for GitHub syncs
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`
- `TALLY_FORM_ID`, `NOTION_API_KEY`, `BROWSERLESS_KEY`
- `OPENAI_API_KEY` and `GEMINI_API_KEY`

Feel free to add service-specific overrides (e.g. `CODEX_*`, `POSTQ_*`) when you
connect more integrations.

## Worker routes you should know
- `GET /health` – lightweight heartbeat (returns 200 when Maggie is alive).
- `GET /diag/config` – lists the config keys loaded into the Worker for the
  current request, including whether KV was used.
- `POST /maggie/restart` – clears Maggie's cached state so the next cycle starts
  fresh (authentication to come later).

Additional automation surfaces exist under `/status`, `/summary`, `/daily`, and
other admin routes. See `worker/worker.ts` for the complete map.

## Next steps
Once the deploy workflow is green and the Worker is reading config from KV, you
can continue layering Codex triggers, GitHub comment webhooks, and other
integrations without touching infra again. Maggie stays online so you can focus
on new behaviors instead of plumbing.
