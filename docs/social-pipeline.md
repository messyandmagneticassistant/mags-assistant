# Social pipeline

## Raw video intake
- Drop raw clips in the Google Drive folder `1ebD1-EvQgOIV5ip9w9eSejBtYjpRPBd6`.
- Mags watches this folder and copies new files into `/Inbox/DATE/` inside the same Drive.

## Drive watch
- Visit `/ops/drive` and click **Start watch** to (re)arm the Google Drive webhook.
- The watcher status is stored in `data/watchers.json` and expires weekly.

## Buffer / Hootsuite tokens
- To enable automatic scheduling supply:
  - `BUFFER_ACCESS_TOKEN`
  - `BUFFER_PROFILE_ID`
- Without these, posts fall back to manual Telegram approval.

## Failure modes
- Missing Google service account credentials: set `GOOGLE_CLIENT_EMAIL`, `FETCH_PASS`, and `GOOGLE_KEY_URL`.
- Missing Buffer credentials: add the env vars above via Vercel dashboard.
- Check runtime logs in Vercel or GitHub Actions for errors.
