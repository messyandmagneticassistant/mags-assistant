# Apps Script Deploy

1. Open Script Editor → **Deploy > New deployment** → type *Web app*.
2. **Execute as:** Me (owner). **Who has access:** Anyone with link.
3. Copy the Web app URL and store it as:
   - GitHub secret: `GAS_INTAKE_URL`
   - (Optional) Cloudflare Worker secret: `GAS_INTAKE_URL`

When wiring Tally webhooks, you can point them either:

- Preferred: Tally → Worker → `GAS_INTAKE_URL` (forward raw body + headers).
- Direct: Tally → `GAS_INTAKE_URL` (disable Worker forwarding to avoid doubles).
