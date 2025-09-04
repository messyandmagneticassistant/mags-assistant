# Donor Flow

Donations are recorded in a Notion database and exposed via worker endpoints.

## Notion Sync

`recordDonation` inserts a page into the `NOTION_DB_ID` database with properties Name, Email, Amount, Intent and Created. `listRecentDonations` queries the database for the most recent entries.

## Embedding

The UI fetches `/donors/recent` and displays a donor wall. To add a donation from a trusted backend, POST to `/donors/add` with header `x-api-key: POST_THREAD_SECRET`.

A simple Notion embed can also be used directly in Notion using the database's share link.
