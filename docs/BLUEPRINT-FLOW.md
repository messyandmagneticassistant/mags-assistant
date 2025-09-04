# Blueprint Flow

1. Visitor selects an offering on the site and is sent to a Stripe checkout.
2. After payment, Stripe redirects or triggers fulfillment to provide downloads.
3. Intake forms are handled via Tally which posts submissions to the worker.
4. The worker can fulfill orders and place downloadable links in KV.
5. Users retrieve downloads via `/downloads` which calls `/orders/links` when available.

## Updating Cohorts & Product IDs

Use the admin config endpoints:

- `blueprint:cohorts` – preset schedules or magnet sets.
- `blueprint:products` – map logical keys to Stripe product IDs and Checkout URLs.
- `blueprint:tally` – map products to Tally form IDs.

Update via `POST /admin/config` with `x-api-key: POST_THREAD_SECRET`.
