# Inventory

## Files
| Path | Status |
| --- | --- |
| `worker/worker.ts` | present |
| `routes/*` | only `worker/routes/browser.ts` |
| `src/tiktok/*` | `caption-generator.ts` |
| `src/trends.*` | _missing_ |
| `src/planner.*` | _missing_ |
| `src/eng/*` | _missing_ |
| `src/browserless.*` | _missing_ |
| `src/http.*` | _missing_ |
| `scripts/*` | `diag-tiktok.ts`, `runAllTasks.ts` |

## Route Map
| Method | Path | Handler |
| --- | --- | --- |
| GET | `/health` | `worker/health.ts:onRequestGet` |
| GET | `/diag/config` | `worker/health.ts:diagConfig` |
| POST | `/api/browser/session` | `worker/routes/browser.ts:onRequestPost` |

## Environment & KV
| Type | Name | Notes |
| --- | --- | --- |
| env | `BROWSERLESS_BASE_URL` | used in scripts/diag-tiktok.ts |
| env | `BROWSERLESS_API_KEY` | browserless clients |
| env | `BROWSERLESS_API_URL` | worker/routes/browser.ts |
| env | `BROWSERLESS_TOKEN` | worker/routes/browser.ts |
| env | `TIKTOK_SESSION_MAGGIE` | diag & actions |
| env | `TIKTOK_SESSION_WILLOW` | actions |
| env | `TIKTOK_SESSION_MARS` | actions |
| env | `TIKTOK_PROFILE_MAGGIE` | diag |
| env | `CAPCUT_EXPORT_FOLDER` | upload helpers |
| env | `CAPCUT_TEMPLATE` | upload helpers |
| env | `CAPCUT_RAW_FOLDER` | upload helpers |
| env | `USE_CAPCUT` | upload helpers |
| env | `TIKTOK_API_UPLOAD_URL` | simulateUploadViaApi |
| env | `FORCE_API_UPLOAD` | uploadOrchestrator |
| env | `TELEGRAM_BOT_TOKEN` | postThread |
| env | `TELEGRAM_CHAT_ID` | postThread |
| env | `MAGGIE_LOG_TO_CONSOLE` | postThread |
| env | `KV` | utils/kv.ts |
| env | `SECRET_BLOB` | worker/lib/config.ts |
| env | `POSTQ` | worker/lib/config.ts (KV namespace) |
| kv  | `thread-state` | configuration blob |

> `worker/health.ts` also checks many other env vars (Stripe, Tally, Notion, Google, etc.) via `/diag/config`.

## Implemented vs Missing
- [x] Health & config diagnostics
- [x] Browserless session route
- [ ] Admin surface (`/admin/status`, `/admin/trigger`)
- [ ] TikTok multiprofile endpoints
- [ ] Trend miner & planner
- [ ] Raw media compose/schedule pipeline
- [ ] Scheduled runner for queue jobs
- [ ] Telegram control surface

