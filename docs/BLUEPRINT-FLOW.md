# Soul Blueprint Flow

1. Visitor lands on the UI and selects an offering.
2. UI embeds the appropriate Tally form.
3. Tally submission posts to `/webhooks/tally`.
4. Worker maps submission to `OrderContext` and stores it in `BRAIN` KV.
5. Worker triggers `/orders/fulfill` which performs fulfillment (download links, email, etc.).
6. Download links are later served from `/orders/links` and gated behind order context.

## Updating Cohorts and Products
The KV namespace `BRAIN` holds configuration:
- `blueprint:cohorts` – preset cohort definitions.
- `blueprint:products` – map of product lookup keys to Stripe IDs.
- `blueprint:tally` – mapping of product lookup keys to Tally form IDs.

Use `/admin/config` endpoints to read or update these values.
