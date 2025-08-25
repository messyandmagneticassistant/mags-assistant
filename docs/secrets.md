# Secrets

The project uses the following environment variables and GitHub Secrets:

- `API_BASE` – Base URL of the deployed API (e.g. https://mags-assistant.vercel.app)
- `WORKER_KEY` – Shared key used by workers and GitHub Actions
- `MAGS_KEY` – Key required for authenticated API requests
- `NOTION_TOKEN` – Notion API token
- `NOTION_DATABASE_ID` – ID of the Notion database for tasks
- `NOTION_INBOX_PAGE_ID` – Notion page ID for the inbox
- `NOTION_HQ_PAGE_ID` – Notion page ID for HQ operations
- `BROWSERLESS_API_KEY` – Optional Browserless API key for automation
- `NOTION_DB_RUNS_ID` – Notion database ID for run logs
- `NEUTER` – Optional; when `true`, disable side-effecting operations
