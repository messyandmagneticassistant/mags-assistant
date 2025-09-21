Maggie Brain

This document describes the intake pipeline, worker integration, and sync helpers.

## KV Snapshot (PostQ/thread-state)

The source of truth for Maggie's operational profile now lives in [`config/kv-state.json`](../config/kv-state.json). The JSON blob currently stored in Cloudflare KV (namespace **PostQ**, key **PostQ:thread-state**) resolves to:

```json
{
  "version": "v1",
  "lastUpdated": "auto",
  "profile": {
    "name": "Maggie",
    "role": "Full-stack assistant",
    "subdomains": [
      "maggie.messyandmagnetic.com",
      "assistant.messyandmagnetic.com"
    ],
    "kvNamespace": "PostQ"
  },
  "services": {
    "gmail": true,
    "stripe": true,
    "tally": true,
    "notion": true,
    "tikTok": true,
    "n8n": true,
    "googleDrive": true
  },
  "automation": {
    "soulReadings": true,
    "farmStand": true,
    "postScheduler": true,
    "readingDelivery": true,
    "stripeAudit": true,
    "magnetMatch": true
  },
  "notes": "Blob initialized from /init-blob",
  "lastSynced": null
}
```

Use `pnpm tsx scripts/updateBrain.ts` (or the workflow outlined below) to sync edits back to KV.

⸻

🔐 Secrets

Two core secret groups are always loaded from KV:
	•	SECRET_BLOB → the main secret bundle (Stripe, TikTok, Notion, Gemini, Cloudflare, etc.)
	•	BRAIN_DOC_KEY → the brain metadata doc (PostQ:thread-state, config flags, TikTok alias map, fundraising keys, etc.)

Worker health + diag always check and report both.

⸻

🔎 Worker Health

The /diag/config endpoint:
	•	Loads both SECRET_BLOB and BRAIN_DOC_KEY from KV.
	•	Confirms presence with presence() (true/false per secret).
	•	Returns:

{
  "present": { "STRIPE_SECRET_KEY": true, "TIKTOK_SESSION_MAIN": true, ... },
  "secretBlobKey": "PostQ:thread-state",
  "brainDocKey": "config:brain",
  "hasSecrets": true,
  "brainDocBytes": 12456
}


⸻

🔄 Sync Rules
	•	SECRETS_BLOB = always hydrated from .env → KV → GitHub
	•	BRAIN_DOC_KEY = always hydrated from docs/brain.md → KV → GitHub
	•	Both must be updated together to prevent drift.
	•	Codex auto-resolves merge conflicts in worker/health.ts by always keeping both key paths.

⸻

📌 Usage
	•	getConfig('stripe') → from SECRET_BLOB
	•	getBrainDoc() → from BRAIN_DOC_KEY
	•	Never hardcode keys; always call via helper.
	•	Maggie reads BRAIN_DOC_KEY for instructions (modes, TikTok alias map, fundraising scope).

