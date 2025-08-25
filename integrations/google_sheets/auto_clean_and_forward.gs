/**
 * Automatically clean Google Sheets and forward form submissions to a worker URL.
 *
 * Constants and secrets:
 *  QUIZ_SHEET_ID – ID of the quiz sheet
 *  FEEDBACK_SHEET_ID – ID of the feedback sheet
 *  WORKER_URL – Script property pointing to the worker endpoint
 *  NOTION_TOKEN – (optional) Notion API token
 *  HQ_DATABASE_ID – (optional) Notion database id for logging
 */

const QUIZ_SHEET_ID = '<PUT_QUIZ_SHEET_ID_HERE>';
const FEEDBACK_SHEET_ID = '<PUT_FEEDBACK_SHEET_ID_HERE>';

// Values pulled from script properties
const SCRIPT_PROPS = PropertiesService.getScriptProperties();
const WORKER_URL = SCRIPT_PROPS.getProperty('WORKER_URL');
const NOTION_TOKEN = SCRIPT_PROPS.getProperty('NOTION_TOKEN');
const HQ_DATABASE_ID = SCRIPT_PROPS.getProperty('HQ_DATABASE_ID');

const SHEETS = [
  { id: QUIZ_SHEET_ID, formSource: 'quiz' },
  { id: FEEDBACK_SHEET_ID, formSource: 'feedback' },
];

/**
 * Entry point: clean sheets and bind triggers.
 */
function cleanAndBindAll() {
  SHEETS.forEach(({ id, formSource }) => {
    const ss = SpreadsheetApp.openById(id);
    const sheet = ss.getSheets()[0];
    backupSheet(ss);
    const cleaned = cleanSheet(sheet, formSource);
    setupTrigger(ss, formSource);
    Logger.log('Cleaned %s (%s rows, headers: %s)', ss.getName(), cleaned.rows, cleaned.headers.join(', '));
  });
}

/**
 * Duplicate the spreadsheet into a dated backup folder.
 */
function backupSheet(ss) {
  const date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const folderName = `Sheets_Backup_${date}`;
  const root = DriveApp.getRootFolder();
  let folder;
  const iter = root.getFoldersByName(folderName);
  folder = iter.hasNext() ? iter.next() : root.createFolder(folderName);
  ss.copy(`${ss.getName()} Backup ${date}`).moveTo(folder);
}

/**
 * Clean the data sheet.
 */
function cleanSheet(sheet, formSource) {
  removeDuplicateHeaders(sheet);
  trimEmpty(sheet);
  normalizeHeaders(sheet);
  ensureColumns(sheet, formSource);
  return {
    rows: sheet.getLastRow() - 1,
    headers: sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0],
  };
}

function removeDuplicateHeaders(sheet) {
  const data = sheet.getDataRange().getValues();
  const header = data[0].join('');
  let dupCount = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i].join('') === header) dupCount++;
    else break;
  }
  if (dupCount > 0) sheet.deleteRows(2, dupCount);
}

function trimEmpty(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const maxRows = sheet.getMaxRows();
  const maxCols = sheet.getMaxColumns();
  if (lastRow < maxRows) sheet.deleteRows(lastRow + 1, maxRows - lastRow);
  if (lastCol < maxCols) sheet.deleteColumns(lastCol + 1, maxCols - lastCol);
}

function normalizeHeaders(sheet) {
  const range = sheet.getRange(1, 1, 1, sheet.getLastColumn());
  const headers = range.getValues()[0].map(normalizeHeader);
  range.setValues([headers]);
}

function normalizeHeader(h) {
  return h
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function ensureColumns(sheet, formSource) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers[0] !== 'timestamp') {
    sheet.insertColumnBefore(1);
    sheet.getRange(1, 1).setValue('timestamp');
  }
  let formCol = headers.indexOf('form_source') + 1;
  if (formCol === 0) {
    sheet.insertColumnAfter(1);
    formCol = 2;
    sheet.getRange(1, formCol).setValue('form_source');
  }
  const dataRange = sheet.getRange(2, formCol, sheet.getLastRow() - 1, 1);
  dataRange.setValue(formSource);
}

/**
 * Install a trigger that forwards new submissions.
 */
function setupTrigger(ss, formSource) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach((t) => {
    if (t.getTriggerSourceId() === ss.getId()) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('forwardSubmission')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();
}

/**
 * Trigger handler: forward row to worker and Notion.
 */
function forwardSubmission(e) {
  const worker = WORKER_URL;
  if (!worker) {
    logError(e, 'WORKER_URL not set');
    return;
  }
  const sheet = e.range.getSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const payload = {};
  headers.forEach((h, i) => (payload[h] = e.values[i]));
  payload.sheet_name = sheet.getName();
  payload.form_source = payload.form_source || '';
  try {
    UrlFetchApp.fetch(worker, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
    });
    if (NOTION_TOKEN && HQ_DATABASE_ID) logToNotion(payload);
  } catch (err) {
    logError(e, err);
  }
}

function logToNotion(data) {
  const url = 'https://api.notion.com/v1/pages';
  const body = {
    parent: { database_id: HQ_DATABASE_ID },
    properties: {
      Name: { title: [{ text: { content: data.sheet_name || 'Form Entry' } }] },
      Data: { rich_text: [{ text: { content: JSON.stringify(data) } }] },
    },
  };
  const headers = {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };
  UrlFetchApp.fetch(url, {
    method: 'post',
    headers,
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
}

function logError(e, err) {
  const ss = e && e.source ? e.source : SpreadsheetApp.getActive();
  let log = ss.getSheetByName('Error_Log');
  if (!log) log = ss.insertSheet('Error_Log');
  log.appendRow([new Date(), err.toString()]);
}
