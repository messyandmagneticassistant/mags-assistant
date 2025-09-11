# Fundraising Module

## Required Secrets
- `DONOR_SHEET_ID`
- `DONOR_FOLDER_ID`
- `NOTION_DONOR_PAGE_ID`
- `STRIPE_LINK_ONE_TIME`
- `STRIPE_LINK_RECURRING`
- `LAND_TARGET_USD`
- `LAND_ADDRESS`
- `LAND_PITCH_TAGS`
- `MAGGIE_SENDER_NAME`
- `MAGGIE_SENDER_EMAIL`

## Sheet Schema
`Org | Contact | Email | Date | Status | Notes`

Submission log rows include `Org | Program | URL | Submitted At | Status | Notes`.

### Status Values
- `sent`
- `no-reply`
- `followed-up-1`

## Endpoints
- `GET  /fundraising/status`
- `POST /fundraising/outreach`
- `POST /fundraising/followup`
- `POST /fundraising/submit`
- `POST /fundraising/onepager`

Use header `x-api-key: CRON_SECRET`.

### Example
```
curl -X POST "$WORKER_URL/fundraising/outreach" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CRON_SECRET" \
  -d '{"contacts":[{"name":"Alex","email":"a@example.com"}]}'
```

## Cron
- 08:30 – auto outreach for new contacts in the `Queue` tab.
- 19:30 – daily report to Telegram and Notion.

Queue contacts in the Google Sheet tab named `Queue`. Each row should provide `Org`, `Contact`, and `Email`.

The latest generated one-pager will be stored in Drive under the donor folder.
