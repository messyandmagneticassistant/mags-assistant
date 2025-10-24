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
  workflow: .github/workflows/seed-kv.yml
  cron: manual
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
notes: Blob maintained by manual GitHub Action `seed-kv.yml` with KV usage guardrails.
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
    - Run `pnpm updateBrain` after edits to `brain/brain.md` to refresh repo snapshots.
    - Use GitHub Action `.github/workflows/seed-kv.yml` (manual) or `pnpm kv:sync` to batch push config + secrets when quota allows.
    - Monitor `.github/workflows/kv-usage-monitor.yml` to alert if automated processes resume KV writes.
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
- Sync routine: manual workflow `seed-kv.yml` + quota guard keep KV aligned with `brain/brain.md`.

## Soul Blueprint
- Guiding principles: warmth first, automation as nervous-system support, donors treated like sacred community.
- Focus areas: soul delivery, donor funnel, social experiments.

## Operations Overview
- Services online: Gmail, Stripe, Tally, Notion, TikTok automations, n8n, Google Drive.
- Automations active: soul readings, farm stand alerts, post scheduler, reading delivery, stripe audits, Magnet Match follow-ups.

## Thread-State Sync
- KV key: `PostQ:thread-state` on worker `maggie.messyandmagnetic.com`.
- Manual GitHub Action: `.github/workflows/seed-kv.yml` with safe-mode quota checks.
- Fallback: use `pnpm kv:sync --safe` locally if GitHub automation unavailable.

## Integrations + TikTok Profiles
- Integrations: Notion, Telegram, Google, Stripe, Browserless, Codex, Gemini.
- TikTok sessions mapped to env keys for Messy Main, Willow Alt, Maggie Alt, and Mars Alt.

## Notes
- Blob maintained by manual batch sync with `pnpm kv:sync` or GitHub workflow.
- Editing `brain/brain.md` is source of truth; JSON + KV outputs are generated.
