# Manual Cloudflare KV config sync

The workflow [`.github/workflows/manual-kv-config-sync.yml`](../.github/workflows/manual-kv-config-sync.yml) lets you push the
repository's config JSON blobs into Cloudflare KV on demand. It wraps the existing `pnpm kv:sync` script with quota checks so you
can safely update `PostQ:thread-state` (and related keys) without blowing through the 1,000 writes/day guardrail.

## When to run it

Trigger the workflow from the **Actions** tab whenever you need to promote changes in:

- `config/thread-state.json`
- `config/kv-state.json`
- `brain/brain.json` or `brain/brain.md`
- any extra mappings declared in `kv/worker-kv.json`

Missing files or secrets are skipped automatically, so you can reuse the same workflow for partial updates.

## Dispatch inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `dry_run` | `false` | Runs the sync in preview mode. The workflow still resolves payloads but does not write to KV. |
| `min_writes_remaining` | `100` | Abort if the usage snapshot estimates fewer writes remaining than this threshold. |
| `window_seconds` | `86400` | Time window (in seconds) for quota calculations. Use smaller windows when you're watching bursts. |
| `warn_at_writes` | `900` | Emit a workflow warning (and summary note) when writes in the window meet/exceed this number. |
| `reason` | `manual-trigger` | Optional note captured in the job summary so future audits know why the sync ran. |

## Guardrails & environment flags

The workflow sets the following environment variables before calling `pnpm kv:sync`:

- `ALLOW_KV_WRITES=true` – opens the write gate for this job.
- `KV_SYNC_SAFE_MODE=true` and `KV_SYNC_ENFORCE_QUOTA=true` – keep the script in quota-aware mode.
- `KV_SYNC_DAILY_LIMIT=1000` – makes the sync use Cloudflare's default 1,000 writes/day allowance.
- `KV_SYNC_USAGE_WINDOW` / `KV_MANUAL_USAGE_WINDOW` – share the selected analytics window with both the usage probe and the sync.
- `KV_SYNC_MIN_WRITES` / `KV_MANUAL_ABORT_REMAINING` – abort the run if estimated remaining writes drop under the chosen threshold.
- `KV_SYNC_DRY_RUN` – toggles dry-run behavior without editing the workflow itself.

During the preflight check [`scripts/manualKvUsageCheck.ts`](../scripts/manualKvUsageCheck.ts) fetches analytics and will:

1. Append a usage summary (writes, reads, deletes, remaining quota) to the job summary.
2. Emit a GitHub Actions warning if the writes in the window meet the `warn_at_writes` threshold (default 900/day).
3. Fail the workflow early when the remaining writes are at/below `min_writes_remaining` so the sync never starts.

Because `pnpm kv:sync` reuses the same limits, you get a second quota check immediately before any writes occur.

## Local equivalent

To rehearse locally, export the same environment variables and run:

```bash
ALLOW_KV_WRITES=true \
KV_SYNC_SAFE_MODE=true \
KV_SYNC_ENFORCE_QUOTA=true \
KV_SYNC_DAILY_LIMIT=1000 \
KV_SYNC_MIN_WRITES=100 \
KV_SYNC_USAGE_WINDOW=86400 \
pnpm run kv:sync
```

Add `KV_SYNC_DRY_RUN=true` to preview changes without touching Cloudflare. The CLI honors the same guardrails as the workflow.
