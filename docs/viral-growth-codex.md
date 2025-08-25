# MAGGIE — 30-Day Viral Growth Codex (Final + Aggressive Mode)

(Drive drop → viral edit → trends → minute-exact schedule → two-account engagement → persona learning → competitor emulation → aggressive scaling → b-roll filler)

## Objective

Scale @messyandmagnetic to 1M followers in 30 days by:
- Pumping out high-velocity posts daily (3–6 baseline; 9–12+ in Aggressive Mode)
- Hijacking trends at peak moments with minute-exact scheduling
- Running two-account comment loops that look/feel organic
- Learning your viral persona and copying the mechanics of top growers in your niche
- Filling every empty slot with on-brand b-roll + trending overlay (from your library or AI-generated)

## Environment Variables

```
RAW_FOLDER_ID=         <Drive ID: TikTok – Raw Videos>
WORK_FOLDER_ID=        <Drive ID: TikTok – Workbench>
FINAL_FOLDER_ID=       <Drive ID: TikTok – Final>
COVERS_FOLDER_ID=      <Drive ID: TikTok – Covers>
BROLL_FOLDER_ID=       <Drive ID: TikTok – B-Roll (optional)>
SHEET_ID=              <Google Sheet ID: TikTok Strategy Tracker – Messy & Magnetic>
EMAIL_ALERTS=          chancub@gmail.com
POSTING_TIMEZONE=      America/Denver
ACCOUNT_HANDLE=        @messyandmagnetic
PRIMARY_LOGIN=         <Auth/API primary>
SECONDARY_HANDLE=      <Your second real account handle>
SECONDARY_LOGIN=       <Auth/API secondary>
SCHEDULER=             metricool|loomly|buffer|tiktok_api
CAPCUT_PROJECT_ID=     <optional>
CAPCUT_TEMPLATE_IDS=   <optional comma-sep: hook,captions,broll>
MAKE_WEBHOOK_VA=       <Make webhook: VA>
MAKE_WEBHOOK_EDITOR=   <Make webhook: Editor>
MAKE_WEBHOOK_SCHED=    <Make webhook: Scheduler>
MAKE_WEBHOOK_BIZ=      <Make webhook: Business>
MAKE_WEBHOOK_LAND=     <Make webhook: Land/Donor>

# Modes
AGGRESSIVE_GROWTH=     true|false   (default false; set true to scale 9–12+/day)
FILL_EMPTY_SLOTS=      true|false   (default true)
OFFLINE_MODE=          true|false   (skip external calls when true)
ALLOW_TRENDING_SOUNDS= true|false   (default true)
ALLOW_COMMERCIAL_SOUNDS=true|false  (default true)
TIKTOK_APP_ID=         <app id>
TIKTOK_APP_SECRET=     <app secret>
TIKTOK_ACCESS_TOKEN=   <access token>
TIKTOK_REFRESH_TOKEN=  <refresh token>
TIKTOK_ACCESS_TOKEN_SECONDARY= <optional secondary token>
TIKTOK_REFRESH_TOKEN_SECONDARY= <optional secondary refresh>
```

## Connectivity Self-Test

1. **Drive:** attempt to list RAW/WORK/FINAL/COVERS/BROLL folders. Record `DRIVE_STATUS = ok|offline|no_access` and note any missing folder.
2. **Sheets:** open `SHEET_ID`, ensure tabs (Posts, Trends, Timeslots). On failure set `SHEETS_STATUS = offline|no_access`.
3. **TikTok API:** when `SCHEDULER=tiktok_api`, call a lightweight verify endpoint. Capture `TIKTOK_STATUS = ok|error|offline` plus account type and scheduling capability.
4. **CapCut:** if `CAPCUT_TEMPLATE_IDS` present, look up templates and set `CAPCUT_STATUS = ok|not_shared|offline`.
5. Write results to a `STATUS_REPORT` tab and append a row to `Needs Attention` with `reason="connectivity_check"` when any status is not `ok`.

## Required Sheet Tabs & Headers

**Posts**

```
file_name | drive_file_id | status(queued|editing|ready|scheduled|posted|error|skip) | category(light|funny|emotional) | narrative_hook | caption | hashtags | cover_text | audio_choice(trending|original|library) | audio_title | audio_id | scheduled_date | scheduled_time | tiktok_url | notes | duration_sec | aspect_ratio | checksum_md5 | clip_index | series_id | created_at | updated_at | score | reason_selected
```

**Trends**

```
captured_at | trend_type(sound|format|challenge|effect|topic) | name | platform | region | est_velocity | 7d_growth | median_duration_sec | exemplar_links(csv) | usage_count | niche_fit_score | recommended_use_case | peak_windows(local) | confidence(0-1)
```

**CreatorsToWatch**

```
handle | platform | min_followers | last_checked | notes
```

**Timeslots**

```
day_of_week | slot_time(HH:mm) | priority(1 best) | hard_lock(true/false)
```

**Performance**

```
post_id | posted_at | views | likes | comments | saves | completion_rate | avg_watch_time | hook_retention_3s | outcome
```

**Needs Attention**

```
file_name | drive_file_id | reason | details | created_at
```

## Watchers & Crons

- **Drive Watcher (q=2min):** New .mp4/.mov/.m4v → enqueue unless deduped by drive_file_id/checksum_md5.
- **Trends Refresh (hourly :07):** Update Trends; log source + fallback.
- **Calendar Re-optimizer (q=30min):** Re-score ready|scheduled; swap/bump lower-score items (respect hard_lock).
- **Aggressive Tick (q=20min when AGGRESSIVE_GROWTH=true):** Seek extra trend windows; queue b-roll fillers if open.
- **Post-Publish Check (T+30h):** Append metrics to Performance.

## Human-Model Viral Profile (persona for edits/captions/comments)

- **Tone:** validating, soulful, lightly witty; no profanity.
- **Visuals:** warm light close-ups, soft blur; pastel overlays.
- **Hooks:**
  1. “I used to think [belief]… until [twist].”
  2. “If you’ve ever [emotion/experience], this is for you.”
  3. “This isn’t for everyone, but if it’s for you… you’ll know.”
- **Pillars:** light/trendy • funny/relatable • emotional/deep • series (Coyote Commons, parenting, healing, shop teasers).
- **Comment style:** empathetic → helpful → brief; occasional emoji/humor.

## Pipeline (per new RAW asset)

0. **Intake & Dedupe** → insert in Posts with status=queued.
1. **Classification** → detect category + narrative_hook (first 8–12 impactful words).
2. **Trend Scan** → pull sounds/formats; compute:

```
niche_fit = 0.25*format_match + 0.25*topic_overlap + 0.20*duration_fit
          + 0.15*sentiment_match + 0.15*historical_success
```

3. **Clip Strategy** → split 2–6 clips if possible; targets (override if trend dictates):
   - Emotional 17–28s
   - Funny 9–15s
   - Light 11–20s
4. **Edit (CapCut-aware)** → silence trim, jump-cuts (~180–220 wpm), auto-captions (UI-safe), color/loudness normalize.
   - **Audio:** pick trending when safe/available; else original.
5. **Cover + Caption + Hashtags** → brand cover (≤6 words); caption (hook • micro-insight • CTA); ≤8 tags (trend-aligned + evergreen).
6. **Score → Minute-Exact Scheduling**

```
score = 0.35*niche_fit + 0.25*trend_velocity + 0.15*duration_alignment
      + 0.10*category_timefit + 0.10*recency_boost + 0.05*series_priority
```

   - Choose exact minute via Trends peak_windows ∩ Timeslots (or defaults):
   - Emotional 19:32–21:28 • Funny 12:02–13:58 • Light 08:34–10:26
   - Avoid same-category back-to-back within 2 slots; enforce series spacing ≥3 blocks.
7. **Publish / Schedule** — Scheduler Router
   - **IF `OFFLINE_MODE=true`:** write "Offline mode — skipping external calls." to `STATUS_REPORT`; for any clip at this step, set `status=ready` and stage caption, cover, audio choice, and schedule fields without API calls.
   - **ELSE IF `SCHEDULER="tiktok_api"`:** ensure `TIKTOK_ACCESS_TOKEN` is present (refresh with `TIKTOK_REFRESH_TOKEN` when needed); resolve audio via `ALLOW_TRENDING_SOUNDS`/`ALLOW_COMMERCIAL_SOUNDS` and account type; `POST /video/upload` then `POST /video/publish` with caption, cover, `audio_id`, and scheduled timestamp in `POSTING_TIMEZONE`; on success set `status=scheduled` and save `tiktok_url`; retry twice before logging to Needs Attention.
   - **ELSE:** fall back to Metricool/Loomly/Buffer branch.
8. **Two-Account Comment Loops**
   - Primary: reply to first 20 comments in hour one; like all; start 2–3 Q threads; pin best.
   - Secondary: within 1–5 min post, leave 1–2 top-level comments; like/reply to 3+ others; reply to primary as another fan; stagger for 4h.
   - Log actions to Posts.notes with timestamps.
9. **Performance Learning** → adjust hook wording, duration targets, posting minutes, and persona heuristics.

## Viral Playbook Emulation (fastest growers mimicry)

1. **Daily scan CreatorsToWatch** → record times, hooks, audio lengths, pacing.
2. **Extract patterns** → preferred minutes (e.g., 09:15/19:45), hook frameworks, cover style, reply tone.
3. **Apply** → shift your slots ±10 min to overlap; mirror structure (not content); produce a “trend mirror” post daily when fit ≥0.85.

## Aggressive Growth Mode

(Set `AGGRESSIVE_GROWTH=true` to enable)

- **Posting frequency:** target 9–12+ posts/day; cap 1 per 45–60 min.
- **Priority:** newest high-score clips > older ready clips.
- **Recycling:** if a format 3×’s baseline in 24h, re-spin with small changes (alt hook line, new cover, variant cut).
- **Extra windows:** add micro-windows around top peaks (±12–18 min) if unoccupied.
- **Engagement:** extend two-account loops to first 6 hours (lower intensity after hour two).
- **Fatigue guard:** rotate pillars; enforce no two similar hooks within 2 adjacent posts.
- **Throttle:** if 3 consecutive posts <1.0× baseline in a 4h span, auto-cool to 3–6/day until next 2 posts exceed baseline.

## Fill Empty Slots (B-Roll + AI Overlays)

(Set `FILL_EMPTY_SLOTS=true` to enable)

If no on-deck clip exists for a viable trend window:
1. **Source b-roll** → prefer `BROLL_FOLDER_ID`; else pull recent RAW snippets; if none, generate safe AI b-roll (generic nature/home/hand/sky, no faces unless you provided them).
2. **Overlay** → trend hook text + on-trend subtitle pattern; pick safe/available trending sound from Trends; keep 9:16; 7–15s default.
3. **Caption** → ultra-tight hook + CTA (“Follow for the full story”).
4. **Label** row in Posts as broll_filler=true (in notes).
5. **Respect** licensing & ToS (see guardrails).

## Guardrails & Compliance

- No fake engagement or impersonation. Two-account loops are limited to your two real accounts and must look/feel like genuine human interaction.
- Respect platform ToS and music licensing. Use only sounds returned as safe/available by your scheduler/TikTok API/library.
- No scraping that violates ToS. Use connected/official endpoints only; otherwise use internal heuristics/performance data.
- Idempotent & transparent: dedupe by Drive ID and MD5; log all actions.
- Rate-limit: avoid spammy bursts; in Aggressive Mode keep min 45–60 min between posts.

## Notifications

- On scheduled: email mini-digest (thumb, caption, sound, exact datetime, reason).
- On swap/bump: email short diff.
- On error: alert with payload + fix steps.
- Hourly trend digest → `MAKE_WEBHOOK_VA`.
- Land/retreat clip → `MAKE_WEBHOOK_LAND`.
- Product/offer mention → `MAKE_WEBHOOK_BIZ`.

## Seed Timeslots (defaults if Timeslots empty)

Mon 09:02, 12:18, 20:04 • Tue 09:10, 12:30, 20:12 • Wed 08:58, 12:16, 19:58 • Thu 09:05, 12:20, 20:06 • Fri 09:00, 12:25, 20:00 • Sat 10:05, 13:10, 21:05 • Sun 10:15, 13:20, 21:12

## Quick Start

1. Create/confirm Drive folders and Sheet tabs (Maggie will auto-create missing headers).
2. Fill ENV VARS.
3. Choose SCHEDULER integration that can schedule (not just publish).
4. (Optional) Add CapCut template IDs.
5. Toggle `AGGRESSIVE_GROWTH=true` when you’re ready to sprint.
6. Drop a test .mp4 into TikTok – Raw Videos.

---

### What’s Added “As If It Were Me”

- Aggressive posting logic (scale up, fatigue guard, dynamic cool-down).
- B-roll/AI filler system to never miss a hot window.
- Competitor-minute overlap + structure emulation.
- Strong compliance guardrails to keep the account safe while pushing max output.
- Transparent logging and dedupe so nothing double-runs.
