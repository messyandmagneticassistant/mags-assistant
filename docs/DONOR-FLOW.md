# Donor Flow

Donations are captured through a Notion database.

1. UI posts to `/donors/add` with donor details and auth token.
2. Worker stores donation in Notion via `recordDonation`.
3. `GET /donors/recent` reads latest entries and returns JSON for embedding on the donor wall.

The Notion database is defined by `NOTION_DB_ID` and authenticated with `NOTION_API_KEY`.
