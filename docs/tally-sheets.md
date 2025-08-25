# Tally → Google Sheets Intake

This doc shows how Tally form submissions travel through the Worker into a single Google Apps Script web app and end up in Google Sheets.

## URLs

- **Worker**: `https://maggie-worker.messyandmagnetic.workers.dev`
- **GAS intake**: secret `GAS_INTAKE_URL`

## Forms

| Form | Form ID | Sheet ID | Tab |
| --- | --- | --- | --- |
| Quiz | `3qlZQ9` | `1JCcWIU7Mry540o3dpYlIvR0k4pjsGF743bG8vu8cds0` | `Quiz_Responses` |
| Feedback | `nGPKDo` | `1DdqXoAdV-VQ565aHzJ9W0qsG5IJqpRBf7FE6-HkzZm8` | `Feedback_Responses` |

All tabs share the normalized header set:
```
timestamp, form_id, submission_id, email, full_name, phone,
product_choice, score, result_tier, rating, feedback_text,
source, user_agent, ip, raw_json
```

## Apps Script Web App

Paste the following code into a new Apps Script project:
```javascript
const FORMS = {
  '3qlZQ9': { sheetId: '1JCcWIU7Mry540o3dpYlIvR0k4pjsGF743bG8vu8cds0', tab: 'Quiz_Responses' },
  'nGPKDo': { sheetId: '1DdqXoAdV-VQ565aHzJ9W0qsG5IJqpRBf7FE6-HkzZm8', tab: 'Feedback_Responses' },
};
const HEADERS = ['timestamp','form_id','submission_id','email','full_name','phone','product_choice','score','result_tier','rating','feedback_text','source','user_agent','ip','raw_json'];

function doPost(e){
  const body = JSON.parse(e.postData.contents || '{}');
  const f = FORMS[body.form_id];
  const log = getLogSheet();
  const ts = new Date().toISOString();
  if (!f){
    log.appendRow([ts, body.form_id, body.submission_id, '', '', 'ignored', '']);
    return ContentService.createTextOutput('ignored');
  }
  const sh = SpreadsheetApp.openById(f.sheetId).getSheetByName(f.tab);
  fixHeaders(sh);
  const row = HEADERS.map(h => body[h] || '');
  row[0] = ts;
  row[14] = JSON.stringify(body);
  const existing = sh.createTextFinder(body.submission_id).matchEntireCell(true).findNext();
  if (!existing) sh.appendRow(row);
  log.appendRow([ts, body.form_id, body.submission_id, f.sheetId, f.tab, 'ok', '']);
  return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e){
  const id = e.parameter.sheetId;
  const tab = e.parameter.tab;
  const limit = Number(e.parameter.limit || 100);
  const sh = SpreadsheetApp.openById(id).getSheetByName(tab);
  const [headers, ...rows] = sh.getDataRange().getValues();
  const sliced = rows.slice(-limit).map(r => {
    const obj = {};
    headers.forEach((h,i)=> obj[h] = r[i]);
    return obj;
  });
  return ContentService.createTextOutput(JSON.stringify(sliced)).setMimeType(ContentService.MimeType.JSON);
}

function getLogSheet(){
  const s = SpreadsheetApp.openById(FORMS['3qlZQ9'].sheetId);
  return s.getSheetByName('Logs') || s.insertSheet('Logs');
}

function fixHeaders(sh){
  const h = sh.getRange(1,1,1,HEADERS.length).getValues()[0];
  if (h.join() !== HEADERS.join()) sh.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
}
```

### Deploy

1. `Deploy → New deployment` → **Web app**.
2. Execute as **Me**; access: **Anyone with the link**.
3. Copy the deployed URLs:
   - POST URL → set as secret `GAS_INTAKE_URL`.
   - GET base URL → set as secret `GAS_READ_URL`.
4. Redeploy the Worker after updating secrets.

## Testing

Send a synthetic payload to the Worker `/tally/webhook` endpoint and confirm a new row appears in the target tab and a line is appended in the `Logs` tab.

The `GAS_READ_URL` endpoint supports `GET ?sheetId=<id>&tab=<tab>&limit=100` and returns normalized JSON rows for use by the brain sync workflow.

## Maintenance

After deploying the Worker, register webhooks and disable old integrations:

```sh
node scripts/tally-webhook-register.mjs
```

To replay historical submissions into Sheets:

```sh
node scripts/tally-backfill.mjs
```

Both scripts require `TALLY_API_KEY` (and `TALLY_WEBHOOK_SECRET` for backfill) in the environment.
