# Notion Scheduler Webhook

Database fields (minimal):

```json
{
  "Title": { "title": {} },
  "Status": { "select": {"options": ["Idea","Editing","Ready","Queued","Posted"]}},
  "Platform": { "multi_select": {} },
  "Asset IDs": { "multi_select": {} },
  "BestTime": { "rich_text": {} },
  "Notes": { "rich_text": {} }
}
```

Create an automation in Notion:

1. In the Scheduler database, click **Automations → Add Automation**.
2. Trigger: When **Status** changes to **Ready**.
3. Action: **Send a webhook** and paste your Worker URL `/api/notion/changed`.
4. Save.

## Telegram Bot Commands

Register the following commands with BotFather:

- `/status` – check worker health
- `/queue` – list next queued posts
- `/reschedule` – `/reschedule {id} {HH:mm}` update BestTime
- `/promote` – `/promote {id}` mark a post as Posted
