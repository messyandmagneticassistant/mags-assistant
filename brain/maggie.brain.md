# Maggie Self-Healing Protocol (Telegram)

## Conflict auto-resolution
- Run `pnpm telegram:auto-repair` when Git reports merge conflicts in any `telegram.ts` file.
- The helper script will:
  - Scan for Git conflict markers.
  - Preserve the most complete handler logic (prioritizing slash commands like `/status`, `/repair telegram`, `/post`).
  - Keep interfaces that use `snapshot`, `recordInput`, and `sendTelegram` helpers when available.
  - Commit fixes automatically with the message `auto: resolved Telegram handler conflict`.
  - Trigger tests before allowing deployment.

## Deployment & restart routine
- After conflict repair succeeds and tests pass, deploy the Cloudflare Worker (`pnpm run deploy:public` by default).
- Optionally restart downstream services with `TELEGRAM_REPAIR_RESTART_COMMAND` when configured.
- Confirm recovery in Telegram by sending `Maggie is fully back online 🚀`.

## Logging
- Every repair attempt is logged to:
  - Notion database `Maggie System Events` (configure via `NOTION_TOKEN` + `NOTION_MAGGIE_EVENTS_DB`).
  - Google Sheet `Maggie Telegram Auto-Fixes Log` (service account + `GOOGLE_MAGGIE_AUTOFIX_SHEET_ID`).
- Logged fields include timestamp, action (`merge`, `deploy`, `restart`, `check`), trigger source, and success status.

## Persistent watcher
- Use `pnpm telegram:auto-repair:watch` to keep a watcher running every 10 minutes.
- The watcher checks for merge conflicts, verifies the worker Telegram route, attempts repairs, deploys, logs results, and posts updates in Telegram.
- The watcher can also be launched manually by running the script in response to `/repair telegram` or other triggers.

## Offline safeguard
- If conflicts are detected but the auto-resolver cannot apply a fix, immediately notify Telegram with `🧯 Maggie is offline. Auto-repair sequence initiated...` and log the failure.

Configure environment variables for Notion, Google Sheets, deployment, restart commands, and Telegram credentials so that Maggie can operate autonomously.
