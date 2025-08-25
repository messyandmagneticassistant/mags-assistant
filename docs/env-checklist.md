# Environment Checklist

| Variable | Description | Location |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | Vercel, Cloudflare Worker |
| `TELEGRAM_CHAT_ID` | Telegram chat ID for notifications | Vercel, Cloudflare Worker |
| `NOTION_TOKEN` | Notion API token | Vercel, Cloudflare Worker |
| `NOTION_HQ_PAGE_ID` | Notion HQ page | Vercel, Cloudflare Worker |
| `NOTION_DATABASE_ID` | Task database | Vercel, Cloudflare Worker |
| `TALLY_WEBHOOK_SECRET` | Tally webhook secret | Vercel, Cloudflare Worker |
| `TALLY_SECRET_MAIN` | Tally main form secret | Vercel, Cloudflare Worker |
| `TALLY_SECRET_FEEDBACK` | Tally feedback form secret | Vercel, Cloudflare Worker |
| `STRIPE_SECRET_KEY` | Stripe API key | Vercel, Cloudflare Worker |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | Vercel, Cloudflare Worker |
| `RESEND_API_KEY` | Resend email API key | Vercel, Cloudflare Worker |
| `WORKER_KEY` | Shared key for worker calls | Vercel, Cloudflare Worker |
| `CRON_SECRET` | Secret token for cron jobs | Vercel, Cloudflare Worker |
| `GOOGLE_CLIENT_EMAIL` | Google service account email | Vercel, Cloudflare Worker |
| `GOOGLE_PRIVATE_KEY_P1`…`P4` | Google service account private key parts | Vercel, Cloudflare Worker |
| `SCRAPER_PROVIDER` | scraping provider (default `actions`) | Vercel, Cloudflare Worker |
| `SCRAPER_API_KEY` | provider API key (if required) | Vercel, Cloudflare Worker (optional) |
| `SCRAPER_ENDPOINT` | provider endpoint (if required) | Vercel, Cloudflare Worker (optional) |

## CI / automation (optional)

| Variable | Description | Location |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | GitHub secrets |
| `CLOUDFLARE_ZONE_ID` | Cloudflare zone ID | GitHub secrets (optional) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token | GitHub secrets |

