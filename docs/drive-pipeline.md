# Drive Video Pipeline

1. Upload raw clips to the `Raw_Footage_Inbox` folder on Google Drive.
2. A cron job runs every five minutes and moves new video files to `Review_Queue` and pings Telegram for approval.
3. Tap **Approve** to move the file into `Ready_To_Schedule` and queue it for processing, or **Decline** to send it to `Failed`.
4. Approved clips continue through the existing workflow for editing and scheduling.
