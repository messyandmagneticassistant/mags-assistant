# Maggie Brain Snapshot

> Auto-synced from [`brain/brain.md`](../brain/brain.md) at 2025-10-08T00:31:06.483Z.

## Profile
- **Name:** Maggie
- **Role:** Full-stack assistant
- **Subdomains:**
  - maggie.messyandmagnetic.com
  - assistant.messyandmagnetic.com
- **KV namespace:** PostQ

## Maggie Logic
- **Daily loop:**
  - Watch Google Drive `/Drive/TikTok Raw` for uploads and label status.
  - Schedule, caption, and upload drafts with trending overlays and safe batching.
  - Retry flops automatically, report recoveries, and rebalance queue volume.
- **Sync routine:**
  - Run `pnpm updateBrain` after edits to `brain/brain.md` to push Cloudflare KV.
  - GitHub Action `.github/workflows/sync-brain.yml` refreshes timestamps nightly at 03:30 UTC.
  - Worker cron `syncThreadStateFromGitHub` backfills `thread-state` + `PostQ:thread-state` if GitHub diverges.

## Soul Blueprint
- **Guiding principles:**
  - Lead with warmth, consent, and transparency while scaling Chanel's reach.
  - Protect Chanel's nervous system with sane automation and clear handoffs.
  - Keep donors and community members feeling seen, supported, and respected.
- **Focus areas:**
  - Soul readings + blueprint deliveries
  - Donor funnel stewardship and follow-up
  - Social resonance experiments + analytics

## Operations
- **Services online:**
  - gmail
  - stripe
  - tally
  - notion
  - tikTok
  - n8n
  - googleDrive
- **Automations active:**
  - soulReadings
  - farmStand
  - postScheduler
  - readingDelivery
  - stripeAudit
  - magnetMatch

## Thread State Sync
- **KV key:** `PostQ:thread-state`
- **Worker:** `maggie.messyandmagnetic.com`
- **GitHub Action:** .github/workflows/sync-brain.yml
- **Cron cadence:** 30 3 * * *

## Integrations
- notion
- telegram
- google
- stripe
- browserless
- codex
- gemini

## Notes
- Blob maintained by nightly GitHub Action `sync-brain.yml` and worker cron fallbacks.
