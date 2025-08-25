# Operations

## One-time setup
1. Deploy the Cloudflare Worker and note its public URL.
2. Set the Telegram webhook to `https://maggie-worker.messyandmagnetic.workers.dev/api/telegram`.
3. Configure all required secrets on both Vercel and Cloudflare (`TELEGRAM_*`, `NOTION_*`, `STRIPE_*`, `TALLY_WEBHOOK_SECRET`, `RESEND_API_KEY`, `GOOGLE_*`, optional `FETCH_PASS`).
4. Configure the Vercel project to serve `/public/check.html` and expose `/api/*` routes.
5. Enable the Worker cron for daily execution.
6. Confirm `/public/check.html` points at the correct Worker base URL.

## Daily checklist
- Open `/check.html`.
- Ensure all probes show green.
- Press **Sync** and **Audit** if needed and confirm success messages.

## Telegram commands
- `/ping` – verify the bot is online.
- `/help` – list commands.
- `/sync` – run the Stripe → Notion sync.
- `/audit` – run the price audit.

## Adding a new agent
1. Implement the agent function and export it from `src/agent/dispatcher.ts`.
2. Map the agent name to the function in the dispatcher.
3. Create a Worker route (e.g. `/agent/your-agent`) that calls `runAgent`.
4. Optionally add buttons or probes in `/public/check.html`.
