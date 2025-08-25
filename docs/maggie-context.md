# Maggie Context

## Checkout Mapping

- Hidden tab **Rules_Links** in the quiz sheet (`1JCcWIU7Mry540o3dpYlIvR0k4pjsGF743bG8vu8cds0`) maps `bundle_id` to Stripe Payment Link. Unhide the tab to edit column **B** with real links.
- If the `STRIPE_LINKS_JSON` secret exists it seeds `Rules_Links` using JSON like `{"BNDL_A":"https://…","BNDL_A2":"https://…","BNDL_S":"https://…","BNDL_E":"https://…"}`. Without it, sample rows remain and must be replaced manually.
- `Quiz_Responses` contains two automation columns: `bundle_reco` and `bundle_payment_link`.
- Apps Script helpers (via **MM Tools** menu):
  - `Rebuild Dashboard Tabs`
  - `Recompute ALL Bundle Recos`
  - `Recompute ALL Payment Links`
- The Cloudflare worker forwards Tally payloads to `GAS_INTAKE_URL`; do not re‑wire the webhook.
