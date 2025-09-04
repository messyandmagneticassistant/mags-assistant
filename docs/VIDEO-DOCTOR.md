# Video Doctor Pipeline

The Video Doctor workflow scans the configured Google Drive folder for new raw clips and prepares viral-ready variants. Each clip is trimmed into 7–15s, 16–22s and 23–35s options with burned‑in captions and a branded hook card.

## Safety Redaction
Frames are inspected every 0.5s using simple heuristics (see `src/social/safety.ts`). If potentially flaggable regions are found the clip is auto-cropped when possible or blurred/covered with a neutral shape. **Never generate clothing for people, especially minors.** If the risk remains high the clip is moved to a human review queue.

## Customisation
- Caption styles live in `src/social/captions.ts`
- Edit the duration presets in `scripts/video-doctor.ts`
- Change fonts by setting the `BRAND_FONT` environment variable

## Storage Policy
Edited outputs are uploaded back to Drive. Originals are archived by default for 30 days. Adjust via `DELETE_POLICY` (`archive-30d`, `archive-7d`, `hard-delete`).

To temporarily pause processing set `KV` key `social:pause` to `true`.
