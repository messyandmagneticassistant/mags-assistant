# Quickstart

## curl examples
```sh
# Upload cookies for an account
curl -X POST $WORKER_URL/tiktok/cookies \
  -H 'Content-Type: application/json' \
  -d '{"handle":"maggie","cookies":["a=1"]}'

# Run planner
curl -X POST $WORKER_URL/planner/run -H 'Content-Type: application/json' -d '{}'

# Queue a post
curl -X POST $WORKER_URL/tiktok/post \
  -H 'Content-Type: application/json' \
  -d '{"handle":"maggie","videoUrl":"https://example.com/v.mp4","caption":"hi"}'

# Orchestrate engagement plan
curl -X POST $WORKER_URL/tiktok/eng/orchestrate \
  -H 'Content-Type: application/json' \
  -d '{"postUrl":"https://tiktok.com/...","main":"maggie","boosters":[{"handle":"alt","offsetSec":30}]}'

# Status
curl $WORKER_URL/admin/status
```

## Env vars & KV keys
- Env: `POSTQ`, `BROWSERLESS_API_URL`, `BROWSERLESS_TOKEN`, any `TIKTOK_SESSION_*`, `TIKTOK_PROFILE_*`
- KV keys: `thread-state`, `tiktok:accounts`, `tiktok:cookies:<handle>`, `tiktok:queue`, `tiktok:trends`, `tiktok:plan:today`

## Notes
- Use responsibly and respect TikTok ToS.
- Space out automation steps to avoid rate limits.
