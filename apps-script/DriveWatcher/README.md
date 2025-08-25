# Drive Watcher

1. Open [script.google.com](https://script.google.com) and create a new project.
2. Paste `Code.gs` into the editor.
3. In **Project Settings**, add script properties `FETCH_PASS` and `RAW_FOLDER_ID`.
4. From the left menu choose **Triggers** and add a trigger:
   - Function: `onChange`
   - Event source: Time-driven
   - Type: Every 10 minutes
5. Save. New files in the Raw Uploads folder will be renamed, moved to `Inbox`, and posted to the Worker endpoint.
