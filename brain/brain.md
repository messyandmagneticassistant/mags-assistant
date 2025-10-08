---
version: v1
profile:
  name: Maggie
  role: Full-stack assistant
  subdomains:
    - maggie.messyandmagnetic.com
    - assistant.messyandmagnetic.com
  kvNamespace: PostQ
threadState:
  kvKey: PostQ:thread-state
  workerSubdomain: maggie.messyandmagnetic.com
  workflow: .github/workflows/sync-brain.yml
  cron: '30 3 * * *'
services:
  gmail: true
  stripe: true
  tally: true
  notion: true
  tikTok: true
  n8n: true
  googleDrive: true
automation:
  soulReadings: true
  farmStand: true
  postScheduler: true
  readingDelivery: true
  stripeAudit: true
  magnetMatch: true
infrastructure:
  kv:
    namespace: PostQ
    key: PostQ:thread-state
    worker: Cloudflare Worker
  storage:
    secretBlob: thread-state
    docs:
      brain: brain/brain.md
  backups:
    github:
      branch: chore/nightly-brain-sync
      path: config/kv-state.json
notes: Blob maintained by nightly GitHub Action `sync-brain.yml` and worker cron fallbacks.
integrations:
  notion: true
  telegram: true
  google: true
  stripe: true
  make: false
  browserless: true
  codex: true
  gemini: true
tiktokProfiles:
  messyMain:
    sessionEnv: TIKTOK_SESSION_MAIN
    handle: '@messyandmagnetic'
  willowAlt:
    sessionEnv: TIKTOK_SESSION_WILLOW
    handle: '@willowhazeltea'
  maggieAlt:
    sessionEnv: TIKTOK_SESSION_MAGGIE
    handle: '@maggieassistant'
  marsAlt:
    sessionEnv: TIKTOK_SESSION_MARS
    handle: '@messy.mars4'
maggieLogic:
  dailyLoop:
    - Watch Google Drive `/Drive/TikTok Raw` for uploads and label status.
    - Schedule, caption, and upload drafts with trending overlays and safe batching.
    - Retry flops automatically, report recoveries, and rebalance queue volume.
  syncRoutine:
    - Run `pnpm updateBrain` after edits to `brain/brain.md` to push Cloudflare KV.
    - GitHub Action `.github/workflows/sync-brain.yml` refreshes timestamps nightly at 03:30 UTC.
    - Worker cron `syncThreadStateFromGitHub` backfills `thread-state` + `PostQ:thread-state` if GitHub diverges.
soulBlueprint:
  guidingPrinciples:
    - Lead with warmth, consent, and transparency while scaling Chanel's reach.
    - Protect Chanel's nervous system with sane automation and clear handoffs.
    - Keep donors and community members feeling seen, supported, and respected.
  focusAreas:
    - Soul readings + blueprint deliveries
    - Donor funnel stewardship and follow-up
    - Social resonance experiments + analytics
lastSynced: null
---
# Maggie Brain

## Maggie Logic
- Daily loop: keep Drive watcher, scheduler, and flop recovery running so Maggie always cycles social tasks without manual nudges.
- Sync routine: follow the GitHub Action + worker cron cadence so KV never drifts from `brain/brain.md`.

## Soul Blueprint
- Guiding principles: warmth first, automation as nervous-system support, donors treated like sacred community.
- Focus areas: soul delivery, donor funnel, social experiments.

## Operations Overview
- Services online: Gmail, Stripe, Tally, Notion, TikTok automations, n8n, Google Drive.
- Automations active: soul readings, farm stand alerts, post scheduler, reading delivery, stripe audits, Magnet Match follow-ups.

## Thread-State Sync
- KV key: `PostQ:thread-state` on worker `maggie.messyandmagnetic.com`.
- Nightly GitHub Action: `.github/workflows/sync-brain.yml` at 03:30 UTC.
- Fallback: worker cron mirrors `config/kv-state.json` if GitHub diverges.

## Integrations + TikTok Profiles
- Integrations: Notion, Telegram, Google, Stripe, Browserless, Codex, Gemini.
- TikTok sessions mapped to env keys for Messy Main, Willow Alt, Maggie Alt, and Mars Alt.

## Notes
- Blob maintained by nightly sync with manual override via `pnpm updateBrain`.
- Editing `brain/brain.md` is source of truth; JSON + KV outputs are generated.
