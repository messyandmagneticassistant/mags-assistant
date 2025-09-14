const SHARED_SECRET = PropertiesService.getScriptProperties().getProperty('GAS_SHARED_SECRET');
const MAX_THREADS = 20;
const SEARCH_QUERIES = [
  'from:(grants.gov OR foundation OR fund OR grant OR program) newer_than:7d',
  'subject:(application OR proposal OR grant OR funding) newer_than:7d',
  'in:inbox OR in:starred newer_than:7d'
];
const LABEL_NEW = 'Mags/New';
const LABEL_REVIEW = 'Mags/Review';
const LABEL_DRAFTED = 'Mags/Drafted';
const LABEL_REPLIED = 'Mags/Replied';

function doPost(e) {
  try {
    const body = e.postData ? e.postData.contents : '{}';
    const data = JSON.parse(body);
    const auth = e.parameter && e.parameter.Authorization;
    const headerAuth = e.postData && e.postData.type === 'application/json' && e.headers && e.headers.Authorization;
    const bearer = (auth || headerAuth || '').replace('Bearer ', '');
    if (data.secret !== SHARED_SECRET && bearer !== SHARED_SECRET) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }
    const action = data.action;
    if (action === 'scan') return scanAction(data);
    if (action === 'draft') return draftAction(data);
    if (action === 'label') return labelAction(data);
    return json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

function scanAction(data) {
  const sinceDays = Number(data.sinceDays || 7);
  const max = Math.min(Number(data.max || MAX_THREADS), MAX_THREADS);
  const results = [];
  const queries = SEARCH_QUERIES.map(q => q.replace(/newer_than:\d+d/g, '') + ` newer_than:${sinceDays}d`);
  for (const q of queries) {
    const threads = GmailApp.search(q, 0, max);
    for (const thread of threads) {
      if (results.length >= max) break;
      const msg = pickMessage(thread);
      const bodyHtml = msg.getBody();
      const bodyPreview = plainText(bodyHtml).slice(0, 500);
      results.push({
        threadId: thread.getId(),
        subject: thread.getFirstMessageSubject(),
        from: msg.getFrom(),
        date: msg.getDate().toISOString(),
        snippet: msg.getPlainBody().slice(0, 100),
        bodyPreview,
        threadUrl: threadUrl(thread.getId())
      });
      thread.addLabel(getOrCreateLabel(LABEL_NEW));
    }
    if (results.length >= max) break;
  }
  return json({ ok: true, threads: results });
}

function draftAction(data) {
  try {
    const { threadId, subjectAddon, body } = data;
    if (!threadId || !body) return json({ ok: false, error: 'missing fields' });
    const thread = GmailApp.getThreadById(threadId);
    const msg = pickMessage(thread);
    const replySubject = (subjectAddon ? msg.getSubject() + ' ' + subjectAddon : msg.getSubject());
    thread.createDraftReply(body, { subject: replySubject });
    thread.addLabel(getOrCreateLabel(LABEL_DRAFTED));
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

function labelAction(data) {
  try {
    const { threadId, add, remove } = data;
    if (!threadId) return json({ ok: false, error: 'threadId required' });
    const thread = GmailApp.getThreadById(threadId);
    if (add) thread.addLabel(getOrCreateLabel(add));
    if (remove) thread.removeLabel(getOrCreateLabel(remove));
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

function getOrCreateLabel(name) {
  const label = GmailApp.getUserLabelByName(name);
  return label || GmailApp.createLabel(name);
}

function threadUrl(id) {
  return `https://mail.google.com/mail/u/0/#inbox/${id}`;
}

function plainText(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function pickMessage(thread) {
  const me = Session.getActiveUser().getEmail();
  const msgs = thread.getMessages();
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.getFrom().indexOf(me) === -1) return m;
  }
  return msgs[msgs.length - 1];
}

function json(obj, code) {
  const out = ContentService.createTextOutput(JSON.stringify(obj));
  if (code) out.setResponseCode(code);
  return out.setMimeType(ContentService.MimeType.JSON);
}
