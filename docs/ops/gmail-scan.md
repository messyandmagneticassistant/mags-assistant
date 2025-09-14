# Gmail Scan

Periodic Gmail scanning for grant/funding emails. Uses a Google Apps Script web app as a proxy and a GitHub Action that pings it every 30 minutes and summarizes results to Telegram.

## Deploying the Apps Script
1. Go to [script.google.com](https://script.google.com) and create a new project named **Mags Gmail Proxy**.
2. Replace the default file with [`Code.gs`](../../apps-script/MagsGmailProxy/Code.gs).
3. In **Project Settings → Script properties** add `GAS_SHARED_SECRET` with a long random string.
4. Deploy: **Deploy → New deployment → Web app**. Execute as *Me* and grant access to *Anyone with the link*.
5. Copy the web app URL and store it in the GitHub secret `GAS_GMAIL_URL`. Use the same secret value for `GAS_SHARED_SECRET`.

## GitHub Secrets
The workflow reads these secrets (missing ones are ignored):
- `GAS_GMAIL_URL`
- `GAS_SHARED_SECRET`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `OPENAI_API_KEY`
- Optional: `NOTION_TOKEN`, `HQ_DATABASE_ID`

## Gmail Labels
- `Mags/New` – new threads found by the scanner
- `Mags/Review` – needs human review
- `Mags/Drafted` – draft reply created
- `Mags/Replied` – reply sent

## Customization
- Search queries live in `Code.gs` (`SEARCH_QUERIES`). Adjust them or the `MAX_THREADS` limit as needed.
- Scan frequency is controlled by the cron schedule in `.github/workflows/gmail-scan.yml` (currently every 30 minutes).
- To change notification text or auto-drafting behavior, edit `scripts/gmail_scan.mjs`.

## Notion Logging
If `NOTION_TOKEN` and `HQ_DATABASE_ID` are set, each summary is appended to the Notion database with date, from, subject, summary, thread URL, and status.
