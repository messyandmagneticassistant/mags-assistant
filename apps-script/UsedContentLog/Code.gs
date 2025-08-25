const SHEET_ID = PropertiesService.getScriptProperties().getProperty('USED_CONTENT_LOG_SHEET_ID');
const PRIVACY_TAB = 'Privacy Log';
const PRIVACY_HEADERS = [
  'timestamp',
  'face_id',
  'video_id',
  'visibility',
  'posts_today',
  'oversaturated',
  'quality',
  'sensitive_context',
  'warning',
  'result',
  'notes',
];

function appendPrivacyLog(entries) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(PRIVACY_TAB) || ss.insertSheet(PRIVACY_TAB);
  ensurePrivacyHeaders_(sh);
  ensureConditionalFormatting_(sh);
  const existing = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 0), PRIVACY_HEADERS.length).getValues();
  entries.forEach((entry) => {
    const ts = entry.ts instanceof Date ? entry.ts : new Date(entry.ts);
    const day = Utilities.formatDate(ts, 'UTC', 'yyyy-MM-dd');
    const face = entry.faceId || '';
    const video = entry.videoId || '';
    const visibility = entry.visibility || '';
    const quality = entry.quality || '';
    const sensitive = entry.sensitive ? 'yes' : '';
    const postsToday = existing.filter((r) => r[1] === face && String(r[0]).startsWith(day)).length + 1;
    const oversaturated = postsToday > 4 ? 'yes' : '';
    const warnings = [];
    if (oversaturated) warnings.push('oversaturation');
    if (quality.toLowerCase() === 'low') warnings.push('low_quality');
    if (sensitive) warnings.push('sensitive_context');
    const result = entry.result || '';
    const note = result === 'Success' ? '⭐' : '';
    sh.appendRow([
      ts,
      face,
      video,
      visibility,
      postsToday,
      oversaturated,
      quality,
      sensitive,
      warnings.join(','),
      result,
      note,
    ]);
    if (warnings.some((w) => w !== 'oversaturation')) {
      notifyWarning_(face, video, warnings);
    }
    existing.push([ts, face, video, visibility, postsToday, oversaturated, quality, sensitive, warnings.join(','), result, note]);
  });
}

function ensurePrivacyHeaders_(sh) {
  const existing = sh.getRange(1, 1, 1, PRIVACY_HEADERS.length).getValues()[0];
  let needsWrite = false;
  for (let i = 0; i < PRIVACY_HEADERS.length; i++) {
    if (existing[i] !== PRIVACY_HEADERS[i]) {
      needsWrite = true;
      break;
    }
  }
  if (needsWrite) {
    sh.clear();
    sh.getRange(1, 1, 1, PRIVACY_HEADERS.length).setValues([PRIVACY_HEADERS]);
  }
  sh.setFrozenRows(1);
}

function ensureConditionalFormatting_(sh) {
  const resultCol = PRIVACY_HEADERS.indexOf('result') + 1;
  const notesCol = PRIVACY_HEADERS.indexOf('notes') + 1;
  if (resultCol < 1 || notesCol < 1) return;
  const lastRow = sh.getMaxRows();
  const lastCol = PRIVACY_HEADERS.length;
  const dataRange = sh.getRange(2, 1, lastRow - 1, lastCol);
  const colLetter = columnToLetter_(resultCol);
  const flopRule = SpreadsheetApp.newConditionalFormatRule()
    .setRanges([dataRange])
    .whenFormulaSatisfied(`=$${colLetter}2="Flop"`)
    .setBackground('#f4cccc')
    .build();
  const successRule = SpreadsheetApp.newConditionalFormatRule()
    .setRanges([sh.getRange(2, notesCol, lastRow - 1, 1)])
    .whenFormulaSatisfied(`=$${colLetter}2="Success"`)
    .setBackground('#fff2cc')
    .build();
  sh.setConditionalFormatRules([flopRule, successRule]);
}

function columnToLetter_(column) {
  let temp = '';
  while (column > 0) {
    const rem = (column - 1) % 26;
    temp = String.fromCharCode(65 + rem) + temp;
    column = Math.floor((column - rem - 1) / 26);
  }
  return temp;
}

function notifyWarning_(face, video, warnings) {
  const email = PropertiesService.getScriptProperties().getProperty('PRIVACY_ALERT_EMAIL');
  if (!email) return;
  const subject = `Privacy warning for ${face}`;
  const body = `Video ${video} flagged: ${warnings.join(', ')}`;
  MailApp.sendEmail(email, subject, body);
}

function cleanUsedContentLog() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName('UsedContentLog');
  if (!sh) return;

  let lastRow = sh.getLastRow();
  let lastCol = sh.getLastColumn();
  let duplicatesRemoved = 0;
  if (lastRow > 1 && lastCol > 0) {
    duplicatesRemoved = sh.getRange(2, 1, lastRow - 1, lastCol).removeDuplicates();
  }

  let emptyRowsRemoved = 0;
  for (let row = sh.getLastRow(); row >= 2; row--) {
    const values = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    if (values.every((v) => v === '' || v === null)) {
      sh.deleteRow(row);
      emptyRowsRemoved++;
    }
  }

  lastRow = sh.getLastRow();
  lastCol = sh.getLastColumn();
  let headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf('Emoji') === -1) {
    sh.getRange(1, lastCol + 1).setValue('Emoji');
    lastCol++;
  }

  headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  let oldRowsRemoved = 0;
  const dateColIndex = headers.indexOf('Date Posted');
  if (dateColIndex !== -1) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    for (let row = sh.getLastRow(); row >= 2; row--) {
      const value = sh.getRange(row, dateColIndex + 1).getValue();
      const date = value instanceof Date ? value : new Date(value);
      if (date && !isNaN(date) && date < cutoff) {
        sh.deleteRow(row);
        oldRowsRemoved++;
      }
    }
  }

  lastRow = sh.getLastRow();
  lastCol = sh.getLastColumn();
  sh.setFrozenRows(1);
  sh.getBandings().forEach((b) => b.remove());
  sh.getRange(1, 1, 1, lastCol).setFontWeight('bold').setHorizontalAlignment('center');
  sh.autoResizeColumns(1, lastCol);
  sh.getRange(1, 1, lastRow, lastCol).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);

  headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const resultCol = headers.indexOf('Result (Success, Flop, Needs Reposting)') + 1;
  const captionCol = headers.indexOf('Caption') + 1;
  if (resultCol > 0 && captionCol > 0) {
    const dataRange = sh.getRange(2, 1, lastRow - 1, lastCol);
    const resultLetter = columnToLetter_(resultCol);
    const captionLetter = columnToLetter_(captionCol);
    const flopRule = SpreadsheetApp.newConditionalFormatRule()
      .setRanges([dataRange])
      .whenFormulaSatisfied(`=$${resultLetter}2="Flop"`)
      .setBackground('#f4cccc')
      .build();
    const successRule = SpreadsheetApp.newConditionalFormatRule()
      .setRanges([dataRange])
      .whenFormulaSatisfied(`=$${resultLetter}2="Success"`)
      .setBackground('#d9ead3')
      .build();
    const needsRule = SpreadsheetApp.newConditionalFormatRule()
      .setRanges([dataRange])
      .whenFormulaSatisfied(`=$${resultLetter}2="Needs Reposting"`)
      .setBackground('#fff2cc')
      .build();
    const blankCaptionRule = SpreadsheetApp.newConditionalFormatRule()
      .setRanges([dataRange])
      .whenFormulaSatisfied(`=$${captionLetter}2=""`)
      .setBackground('#d9d9d9')
      .build();
    sh.setConditionalFormatRules([flopRule, successRule, needsRule, blankCaptionRule]);
  }

  const totalRows = sh.getLastRow() - 1;
  const message =
    `UsedContentLog cleaned.\n` +
    `Duplicates removed: ${duplicatesRemoved}\n` +
    `Rows older than 60 days removed: ${oldRowsRemoved}\n` +
    `Empty rows removed: ${emptyRowsRemoved}\n` +
    `Total rows remaining: ${totalRows}`;
  sendTelegramUpdate(message);
}

function retryFloppedTikToks() {
  const sheetName = 'UsedContentLog';
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const colIndex = {
    postId: headers.indexOf('Post ID or Filename'),
    result: headers.indexOf('Result (Success, Flop, Needs Reposting)'),
    caption: headers.indexOf('Caption'),
    reused: headers.indexOf('Reused? (Yes/No)'),
    notes: headers.indexOf('Notes'),
  };

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[colIndex.result] === 'Flop' && row[colIndex.reused] !== 'Yes') {
      const caption = row[colIndex.caption];
      const postId = row[colIndex.postId];

      const suggestion = callGeminiFixSuggestion_(caption);

      sheet.getRange(i + 1, colIndex.reused + 1).setValue('Yes');
      sheet.getRange(i + 1, colIndex.notes + 1).setValue('Retry: ' + suggestion);

      sendTelegramUpdate(`📉 Post ${postId} flopped.\n\n💡 Suggested fix:\n${suggestion}`);
    }
  }
}

function callGeminiFixSuggestion_(originalCaption) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const prompt =
    `This TikTok post flopped. Here's the original caption: "${originalCaption}". Suggest a better caption and a short improvement plan that would help it perform better. Make it witty, human, and trendy.`;

  try {
    const response = UrlFetchApp.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        muteHttpExceptions: true,
      },
    );
    const json = JSON.parse(response.getContentText());
    return json.candidates?.[0]?.content?.parts?.[0]?.text || 'No suggestion returned.';
  } catch (e) {
    Logger.log('Gemini API error: ' + e);
    return 'Error retrieving suggestion.';
  }
}

function sendTelegramUpdate(message) {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  const chatId = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
  const url = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(message)}`;
  UrlFetchApp.fetch(url);
}
