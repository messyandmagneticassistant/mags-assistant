const USED_CONTENT_SHEET_ID = PropertiesService.getScriptProperties().getProperty('USED_CONTENT_LOG_SHEET_ID');

function dailyUsedContentCheck() {
  const ss = SpreadsheetApp.openById(USED_CONTENT_SHEET_ID);
  const sh = ss.getSheetByName('UsedContentLog') || ss.getSheets()[0];
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const resultCol = headers.indexOf('Result (Success, Flop, Needs Reposting)') + 1;
  const reusedCol = headers.indexOf('Reused?') + 1;
  const notesCol = headers.indexOf('Notes') + 1;
  const captionCol = findColumn_(headers, 'caption');
  const idCol = findColumn_(headers, 'post id');
  const reasonCol = findColumn_(headers, 'why');
  if (resultCol < 1 || reusedCol < 1 || notesCol < 1) return;
  const lastRow = sh.getLastRow();
  const data = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  const telegramLines = [];
  data.forEach((row, i) => {
    const result = row[resultCol - 1];
    const reused = row[reusedCol - 1];
    if (result === 'Flop' && String(reused).toLowerCase() !== 'yes') {
      const caption = captionCol ? row[captionCol - 1] : '';
      const postId = idCol ? row[idCol - 1] : '';
      const reason = reasonCol ? row[reasonCol - 1] : result;
      const suggestion = geminiFix_(caption);
      if (suggestion) {
        sh.getRange(i + 2, reusedCol).setValue('Yes');
        sh.getRange(i + 2, notesCol).setValue(suggestion);
        telegramLines.push(`Post ${postId} – ${reason}\n${suggestion}`);
      }
    }
  });
  if (telegramLines.length) {
    sendTelegram_(telegramLines.join('\n\n'));
  }
}

function geminiFix_(caption) {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) return '';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${key}`;
  const prompt = `Original caption:\n${caption}\n\nImprove this caption and give a short plan to fix the post.`;
  const body = { contents: [{ parts: [{ text: prompt }]}] };
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  try {
    const json = JSON.parse(res.getContentText());
    const text = json.candidates && json.candidates[0].content.parts.map(p => p.text).join('').trim();
    return text || '';
  } catch (e) {
    return '';
  }
}

function sendTelegram_(text) {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  const chatId = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = { chat_id: chatId, text };
  UrlFetchApp.fetch(url, { method: 'post', payload });
}

function findColumn_(headers, needle) {
  const i = headers.findIndex(h => h && h.toString().toLowerCase().indexOf(needle) >= 0);
  return i >= 0 ? i + 1 : 0;
}
