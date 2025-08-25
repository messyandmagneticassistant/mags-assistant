const WORKER_URL = 'https://maggie-worker.messyandmagnetic.workers.dev/api/media/new';
const FETCH_PASS = PropertiesService.getScriptProperties().getProperty('FETCH_PASS');
const RAW_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('RAW_FOLDER_ID');
const INBOX_NAME = 'Inbox';

function onChange(e) {
  const folder = DriveApp.getFolderById(RAW_FOLDER_ID);
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const ts = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd-HHmm');
    const ext = file.getName().split('.').pop();
    const newName = `${ts}_${file.getName()}`;
    file.setName(newName);
    const inbox = folder.getParents().next().getFoldersByName(INBOX_NAME).next();
    inbox.addFile(file);
    folder.removeFile(file);
    const payload = {
      fileId: file.getId(),
      name: file.getName(),
      size: file.getSize(),
      mimeType: file.getMimeType(),
    };
    UrlFetchApp.fetch(WORKER_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      headers: { 'X-Fetch-Pass': FETCH_PASS },
      muteHttpExceptions: true,
    });
  }
}
