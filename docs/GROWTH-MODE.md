# Growth Mode

This repo ships with an algorithmic growth layer for Maggie's TikTok system.  It stays **safe by default** and only posts when explicitly enabled.

## DRYRUN vs LIVE
- Runs in **DRYRUN** unless `ENABLE_SOCIAL=true`.
- Pass `--dryrun` to the orchestrator to force dry mode even if the env var is set.

## Quotas, Windows and Quiet Hours
- `tiktok:quotas` – per‑profile caps (`dayCap`, `hourCap`, `gapMin`).
- `tiktok:aud:windows` – weighted minute ranges that boost posting probability.
- `tiktok:quiet` – quiet windows; when `soft` weights are halved, otherwise posts are blocked.

## Boost Rules
Helpers (WILLOW, MAGGIE, MARS) react to MAIN posts using `tiktok:boost:rules`.  Each rule lists offsets in minutes and actions (like, save, comment). Randomness is applied within `randomnessSec`.

## KV Locations
- Trend scores: `tiktok:trends:scores`
- Post ledgers: `tiktok:post:ledger:*`
- Draft queue: `tiktok:drafts`

## Flipping the Switch
1. `pnpm run social:dryrun` – shows planned actions.
2. Set secret `ENABLE_SOCIAL=true` to go LIVE.
3. Roll back by setting `ENABLE_SOCIAL=false`.

## Seeding Defaults
POST `/admin/social/seed` with `x-api-key: POST_THREAD_SECRET` to ensure KV defaults are present.  GET `/admin/social-mode` reports current mode.

Stay safe – keeping `ENABLE_SOCIAL=false` disables any network posting while retaining planning output.
