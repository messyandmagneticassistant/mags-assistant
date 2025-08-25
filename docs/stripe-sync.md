# Stripe Sync

Synchronizes Stripe products with a Notion database.

## Setup

1. Configure environment variables in `.env` or in your deployment:
   - `API_BASE` – base URL of this service
   - `STRIPE_SECRET_KEY` – Stripe API key
   - `NOTION_STRIPE_DB_ID` – Notion database containing product specs
   - `DRIVE_PRODUCT_IMAGES_ROOT_ID` – Google Drive folder with product images
   - optional: `RESEND_API_KEY`, `RESEND_FROM`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DALL_E_STYLE_PROMPT`

2. Populate the Notion table with product information.

## Usage

Visit `/admin/stripe` for a dry‑run plan or to apply fixes.

Programmatic access:

- `GET /api/stripe/sync/plan` – returns a diff without changing Stripe.
- `POST /api/stripe/sync/run` – reconciles Stripe with Notion (`?dry=true` to simulate).

## Troubleshooting

- Ensure Notion and Stripe IDs are correct.
- Verify Google Drive folders contain at least one image file.
- Statement descriptors must be 22 characters max, uppercase, and free of special punctuation.
