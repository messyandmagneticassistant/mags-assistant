# Telegram Commands

Maggie can be controlled entirely from the private Telegram bot. Use the commands below for quick operations when you are away from GitHub.

## `/maggie-help`
Lists all supported Telegram commands with a short description so you always know what Maggie can do for you.

## `/start-sync`
Initializes the brain sync pipeline: seeds the Cloudflare KV blob from `brain/brain.json`, verifies `/diag/config`, writes a manual "telegram" entry to the **Brain Syncs** sheet, and reports success or failure back in Telegram along with timestamps.

## `/maggie-status`
Returns a compact health panel that includes the latest brain sync entry (UTC and local), worker `/health` response, the last five task log entries from `var/runtime/tasklog.json`, any error recorded in the **Errors** sheet during the past 24 hours, and quick links to `/health` and `/diag/config`.
