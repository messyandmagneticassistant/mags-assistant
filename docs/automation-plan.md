# Automation Plan for Mags

This document outlines the scaffold for expanding Mags into an automated
assistant that manages social media, Stripe products, grant outreach and
other business operations.

## Social media
- Uses the provider framework in `lib/social`.
- Scheduled tasks:
  - `social.post_due` posts queued clips across configured providers.
  - `social.collect_inbox` would aggregate comments and DMs.
  - `social.refresh_analytics` polls analytics and updates "best times to post".
- Required environment variables (one per platform):
  - `TIKTOK_ACCESS_TOKEN`, `INSTAGRAM_API_KEY`, `YOUTUBE_API_KEY`,
    `PINTEREST_API_KEY`, `TWITTER_API_KEY`, `LINKEDIN_API_KEY`.

## Stripe products
- `stripe.audit` task calls `planStripeSync` to detect missing descriptions,
  images or prices.
- Needs `STRIPE_SECRET_KEY`, `NOTION_STRIPE_DB_ID` and related Notion
  credentials.

## Grant and donor outreach
- `outreach.run` task gathers grant leads, drafts packages and logs
  activity in Notion.
- Requires `NOTION_TOKEN`, `OUTREACH_DB_ID` and email/drive credentials for
  assembling assets.

## File and Drive access
- Service account credentials for both Google Drive accounts should be
  provided via environment variables or mounted JSON key files.

## Tally and quiz funnels
- Supply `TALLY_API_KEY` for quiz retrieval and updates.

## Steps requiring user input
1. Provide API keys and client secrets for each social network.
2. Supply Stripe API key and ensure Notion database IDs are set.
3. Grant the service account access to the shared Google Drive folders.
4. Configure Notion tokens and database IDs for outreach and content
   planning.
5. Add Tally API key for quiz management.

The code in this repository includes placeholder implementations only.
Real API calls, error handling and data mappings must be completed before
running in production.
