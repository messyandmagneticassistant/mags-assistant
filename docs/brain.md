# Maggie Brain

This document describes the intake pipeline, worker integration, and sync helpers.

## Fundraising Secrets

The `SECRETS_BLOB` now also carries keys used by the fundraising module:

- `DONOR_SHEET_ID`
- `DONOR_FOLDER_ID`
- `NOTION_DONOR_PAGE_ID`
- `STRIPE_LINK_ONE_TIME`
- `STRIPE_LINK_RECURRING`
- `LAND_TARGET_USD`
- `LAND_ADDRESS`
- `LAND_PITCH_TAGS`
- `MAGGIE_SENDER_NAME`
- `MAGGIE_SENDER_EMAIL`

## Apps Script

The `MM Intake` Google Apps Script handles webhook payloads from Tally forms and writes
normalized rows into the appropriate Sheets.

### Source
```js
function doPost(e) {
  const body = JSON.parse(e.postData.contents || '{}');
  const id = body.form_id || '';
  const quizSheet = '1JCcWIU7Mry540o3dpYlIvR0k4pjsGF743bG8vu8cds0';
  const feedbackSheet = '1DdqXoAdV-VQ565aHzJ9W0qsG5IJqpRBf7FE6-HkzZm8';
  const headers = ['timestamp','form_id','submission_id','email','full_name','phone','product_choice','score','result_tier','rating','feedback_text','source','user_agent','ip','raw_json'];
  const logHeaders = ['timestamp','form_id','submission_id','target_sheet_id','target_tab','status','error_message'];

  function fixHeadersFor(sheet, tab) {
    const sh = SpreadsheetApp.openById(sheet).getSheetByName(tab);
    const h = sh.getRange(1,1,1,headers.length).getValues()[0];
    if (h.join() !== headers.join()) sh.getRange(1,1,1,headers.length).setValues([headers]);
  }

  function dedupeBySubmissionId(sheet, tab) {
    const sh = SpreadsheetApp.openById(sheet).getSheetByName(tab);
    const data = sh.getDataRange().getValues();
    const seen = {};
    const rows = [];
    data.forEach(r => {
      const id = r[2];
      if (!seen[id]) { seen[id] = true; rows.push(r); }
    });
    sh.clear();
    sh.getRange(1,1,rows.length,headers.length).setValues(rows);
  }

  function writeRow(sheet, tab) {
    fixHeadersFor(sheet, tab);
    const sh = SpreadsheetApp.openById(sheet).getSheetByName(tab);
    const values = headers.map(h => body[h] || '');
    values[0] = new Date().toISOString();
    values[14] = JSON.stringify(body);
    const existing = sh.createTextFinder(body.submission_id).matchEntireCell(true).findNext();
    if (existing) return false;
    sh.appendRow(values);
    return true;
  }

  const logSheet = SpreadsheetApp.openById(quizSheet).getSheetByName('MM_Logs') || SpreadsheetApp.openById(quizSheet).insertSheet('MM_Logs');
  const ts = new Date().toISOString();
  let targetSheet = '', targetTab = '', status = 'ok', err = '';
  try {
    if (id === '3qlZQ9') { targetSheet = quizSheet; targetTab = 'Quiz_Responses'; writeRow(targetSheet, targetTab); }
    else if (id === 'nGPKDo') { targetSheet = feedbackSheet; targetTab = 'Feedback_Responses'; writeRow(targetSheet, targetTab); }
    else status = 'ignored';
  } catch (e) {
    status = 'error'; err = e.message;
  }
  logSheet.appendRow([ts,id,body.submission_id,targetSheet,targetTab,status,err]);
  return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
}

function health() {
  return { ok: true, tabs: ['Quiz_Responses','Feedback_Responses'] };
}
```

Deploy the script as a Web App (execute as me; accessible to anyone with link).
Record the deployed URL here: `TODO_APPS_SCRIPT_URL`.

## Worker

- **/health** – `GET` returns `{ ok, upstreams: { gas: <status|error> } }`.
- **/brain/sync** – `POST` gated by `X-Fetch-Pass` header; currently stubbed.

The worker forwards incoming Tally webhooks to the Apps Script URL stored in the
`GAS_INTAKE_URL` secret.

### Config sync

The `updateBrain()` helper merges local changes with the existing config and
POSTs to `$WORKER_URL/config?scope=brain`, updating the `config:brain` entry in
Cloudflare KV. Each call appends a line to `docs/.brain.md` for audit history.
Run `updateBrain()` after every deploy or manual change to keep the worker and
this GitHub repo in sync.

## Notion schema

| Property | Type |
|---|---|
| Item | title |
| Type | select |
| Submission ID | text |
| Form ID | text |
| Email | email |
| Name | text |
| Phone | text |
| Score | number |
| Result Tier | select |
| Product Choice | select |
| Status | select |
| Stripe Link | url |
| Notes | rich text |
| Created At | date |
| Updated At | date |
| Raw | rich text |
| Source | select |
| Owner | people |

## Stripe helper

The brain sync script can create Payment Links based on quiz outcome. If no Stripe
secret is configured the step is skipped.

## Tally routing

Tally webhooks remain configured to POST → Worker → Apps Script. No direct
Tally → Apps Script hooks are enabled.

## Tally/Sheets Intake

The worker forwards raw Tally JSON to the Apps Script web app, which writes
normalized rows (`timestamp, form_id, submission_id, email, full_name, phone,
product_choice, score, result_tier, rating, feedback_text, source, user_agent,
ip, raw_json`) into the target sheet and logs to a `Logs` tab. The brain sync
workflow reads the latest rows via the `GAS_READ_URL` endpoint, summarizes the
last 100 entries, and posts a compact summary to Telegram and the workflow log.

To add a new form, append `{ "form_id": "<id>", "sheet_id": "<sheet>", "tab": "<tab>" }`
to `intake.tally.forms` in `public/mags-config.json`. Test by sending a synthetic
payload to the worker and confirming the row appears in the sheet and the `Logs`
tab.
