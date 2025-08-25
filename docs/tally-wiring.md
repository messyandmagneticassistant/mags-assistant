# Tally Wiring

Worker-only fan-out keeps submissions in sync across Sheets and Notion.

## Rule

Leave only the Worker webhook enabled on both Tally forms (Quiz `3qlZQ9` and Feedback `nGPKDo`). Disable Tally's direct Google Sheets and Notion integrations to prevent double writes.

## Checklist

- [ ] Quiz form → webhook `https://maggie-worker.messyandmagnetic.workers.dev/tally-intake`
- [ ] Feedback form → webhook `https://maggie-worker.messyandmagnetic.workers.dev/tally-intake`
- [ ] Remove built-in Google Sheets integration
- [ ] Remove built-in Notion integration
- [ ] Submit a test entry and confirm it appears in Sheets and Notion

TODO: add screenshots

