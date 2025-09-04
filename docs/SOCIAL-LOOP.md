# Adaptive TikTok Social Loop

This loop runs every 10 minutes via GitHub Actions and decides whether to post a TikTok video.

## Timing windows
Peer posting windows are derived from recent activity of similar accounts. The current code stores these under `social:analytics:windows` in KV. In this skeleton the windows are empty and should be expanded with real analytics.

## Google Drive intake
Raw clips are pulled from a Google Drive folder specified by `RAW_DRIVE_FOLDER`. Only new files are considered; a cursor is stored at `social:cursor:drive:raw`.

## Pause
Set `social:pause=true` in KV to disable posting while keeping research and scoring active.

## Burst mode
If two consecutive posts beat the median performance by 2× within six hours, temporary burst mode allows up to five posts in a day. The current implementation only sketches the structure and leaves the analytics to be filled in.
