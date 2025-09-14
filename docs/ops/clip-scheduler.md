# Clip Scheduler

Automates scheduling and optional posting of ready video clips to TikTok.

## TikTok cookies

To enable immediate posting, add account cookies to the repo secrets:
`TIKTOK_COOKIE_MAIN`, `TIKTOK_COOKIE_WILLOW`, `TIKTOK_COOKIE_FAIRYFARM`.
If a cookie is missing the clip stays queued until a cookie is available.

## Queue and logs

Scheduled items live in `data/schedule_queue.json` and posting history in
`data/post_log.json`. These files are committed back to the repo after
workflow runs.

## Running manually

Execute the scheduler locally with:

```bash
pnpm tsx scripts/clip_scheduler.mjs
```

## Preferred hours & accounts

Posting hours and defaults come from `public/mags-config.json`. Update the
`preferredPostingHours` array or account settings there to change when clips
are queued.
