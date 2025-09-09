# Social Orchestrator

The `social` GitHub workflow drives the posting queue. It can be triggered
on schedule or manually via **Run workflow**.

## Manual run with override

1. Go to *Actions → Social* and click **Run workflow**.
2. Provide optional `override` JSON. Example:

```json
{"mode":"main-only","window":{"start":"08:00","end":"20:00"}}
```

The JSON is passed to the orchestrator script and can tweak posting windows
or behavior for a single run.

## Jobs

- **Dryrun** – `pnpm run social:dryrun` prints the plan without posting.
- **Orchestrate** – `pnpm tsx src/social/orchestrate.ts '<override>'` performs
  the real scheduling and posting.

## Boosters & Credentials

Boosters control save/copy-link/comment windows to help engagement. Real
cookies and tokens are pulled from the KV `thread-state` configuration so the
workflow never needs secrets checked into the repo.
