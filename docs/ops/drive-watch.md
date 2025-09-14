# Drive Watch

A scheduled GitHub Actions job checks Google Drive for new raw clips and queues them for processing.

## Secrets

Add the following repository secrets:

- **GOOGLE_SA_JSON** – service account JSON for the Drive API
- **RAW_CLIPS_FOLDER_ID** – ID of the folder containing raw clips
- *(optional)* **TELEGRAM_BOT_TOKEN** and **TELEGRAM_CHAT_ID** for Telegram updates
- *(optional)* **NOTION_TOKEN** and **HQ_DATABASE_ID** to log items in Notion
- *(optional)* **GAS_INTAKE_URL** – fallback Apps Script endpoint when Drive auth is unavailable

## Cache file

Processed file IDs are stored in `data/drive_seen.json`. When new clips are found, the workflow updates this file and opens an automated PR so the state persists and clips are not reprocessed.

## Manual run

1. In GitHub, open **Actions → Drive Watch**.
2. Choose **Run workflow** to trigger the job manually.

## Pipeline

Queued files are handed to the existing clip pipeline. The pipeline consumes the Drive ID and handles extraction/overlay.
