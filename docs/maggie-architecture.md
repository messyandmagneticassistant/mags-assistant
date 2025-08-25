# Maggie Automation System

This document outlines a modular Google Apps Script system for the Messy & Magnetic brand. Each workflow can run as an independent microservice or as part of a monolithic Apps Script project.

## Modules

1. **Soul Blueprint Generator** – triggered when new Tally form data hits the `Soul Blueprint Orders – Messy & Magnetic™` sheet. Builds age-aware narrative readings from tier templates, dedupes overlapping chart data, exports Google Doc + branded PDF with visual summary, and emails via role-specific alias with retry logging.
2. **Raw TikTok Drop Folder Automation** – watches the Drive folder `Raw TikTok Drop Folder` and auto-processes videos (tagging, captions, overlays, scheduling).
3. **Flop Retry & Rewrite** – daily check of `UsedContentLog` for flops. Uses Gemini API to suggest rewrites and pings Telegram.
4. **Gmail Integration** – monitors `messyandmagnet@gmail.com` and `chancub@gmail.com` for Stripe, donor, quiz and blueprint emails. Applies labels, forwards, and sends Telegram alerts.
5. **TikTok Booster Logic** – coordinates three booster accounts for engagement routines and logs actions in `TikTokLogs`.
6. **Sheet Formatting** – color codes rows (green viral, yellow pending, red flop), freezes headers, auto-deletes old entries.
7. **Telegram Morning + Evening Summary** – scheduled at 7AM/7PM with daily highlights in Chanel's voice.
8. **Storage & Archiving** – prunes old raw videos and flops, archives blueprints after 90 days, warns if Drive usage exceeds 80%.
9. **Subscriptions & Stripe** – handles daily/monthly updates, generates personalized PDFs, logs Stripe transactions, upsell reminders.
10. **Donor & Grant Automation** – scans Gmail for grant keywords, stores contacts in Donor Tracker sheet and Notion (if enabled).
11. **Soul Subscription Engine** – monitors active subscribers, crafts monthly soul forecasts, and delivers via email or Telegram.
12. **Energy-Aware TikTok Planner** – matches Chanel's blueprint with current astrology and numerology to suggest daily clip vibes and hashtags.
13. **Donor Cycle Tracker** – schedules gratitude notes, flags cold leads, and drafts follow-up emails.
14. **Telegram Daily Energy Ping** – 6AM message with vibe check, suggested post type, and color/food alignment.

## Script Properties
Use `PropertiesService.getScriptProperties()` to store API keys and IDs:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `GEMINI_API_KEY`
- `USED_CONTENT_LOG_SHEET_ID`
- `TIKTOK_LOG_SHEET_ID`
- Template IDs for all Blueprint tiers (`TEMPLATE_MINI`, etc.)
- Folder IDs as needed
- Accounting email address

## Triggers

- **onFormSubmit** – `onSoulBlueprintSubmit`
- **Drive** – `onRawTikTokUpload`
- **Time-driven** – daily `dailyUsedContentCheck`, `boosterDaily`, `formatSheets`, `pruneStorage`, `morningSummary`, `eveningSummary`, `dailyEnergyPing`; monthly `monthlyForecasts`
- **Hourly** – `checkMailboxes`, `donorAutomation`, `processSubscriptions`

## External Services

- Speech-to-text (YouTube captions or Whisper API)
- TikTok scheduler & trending audio API
- Gemini API for caption rewrites
- Notion API for donor tracking (optional)

## Voice & Tone
All outbound messages and logs should keep Chanel's voice: emotional, validating, witchy, healing, and dry-humored.

