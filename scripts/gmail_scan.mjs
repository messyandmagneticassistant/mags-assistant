import fs from 'fs';

const file = process.argv[2] || 'scan.json';
let threads = [];
try {
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw);
  threads = data.threads || [];
} catch (err) {
  console.error('Failed to read scan file:', err.message);
}

const {
  OPENAI_API_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  GAS_GMAIL_URL,
  GAS_SHARED_SECRET,
  NOTION_TOKEN,
  HQ_DATABASE_ID,
} = process.env;

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text })
    });
  } catch (err) {
    console.error('Telegram send failed:', err.message);
  }
}

async function callOpenAI(prompt) {
  if (!OPENAI_API_KEY) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
    });
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    return content;
  } catch (err) {
    console.error('OpenAI error:', err.message);
    return null;
  }
}

async function appendNotion(item, summary) {
  if (!NOTION_TOKEN || !HQ_DATABASE_ID) return;
  try {
    await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { database_id: HQ_DATABASE_ID },
        properties: {
          Name: { title: [{ text: { content: item.subject.slice(0, 200) } }] },
          Date: { date: { start: item.date } },
          From: { rich_text: [{ text: { content: item.from } }] },
          Summary: { rich_text: [{ text: { content: summary.slice(0, 2000) } }] },
          'Thread URL': { url: item.threadUrl },
          Status: { select: { name: 'Scanned' } }
        }
      })
    });
  } catch (err) {
    console.error('Notion error:', err.message);
  }
}

async function draftViaGAS(threadId, body) {
  if (!GAS_GMAIL_URL || !GAS_SHARED_SECRET) return false;
  try {
    const res = await fetch(GAS_GMAIL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'draft', secret: GAS_SHARED_SECRET, threadId, body })
    });
    const json = await res.json();
    return json.ok;
  } catch (err) {
    console.error('Draft error:', err.message);
    return false;
  }
}

async function processThreads() {
  if (!threads.length) {
    await sendTelegram('No new grant/mail in last 30m');
    return;
  }

  const out = [];
  for (const t of threads.slice(0, 5)) {
    const prompt = `Summarize and assess if this email is about grants, funding, or property. Return JSON {summary, shortReply?, longReply?, nextSteps?}.
From: ${t.from}
Subject: ${t.subject}
Body: ${t.bodyPreview}`;
    let summary = '';
    let shortReply = '';
    let longReply = '';
    let nextSteps = [];
    const ai = await callOpenAI(prompt);
    if (ai) {
      try {
        const parsed = JSON.parse(ai);
        summary = parsed.summary || '';
        shortReply = parsed.shortReply || '';
        longReply = parsed.longReply || '';
        nextSteps = parsed.nextSteps || [];
      } catch (err) {
        summary = ai.slice(0, 500);
      }
    }
    await appendNotion(t, summary);
    out.push({ thread: t, summary, shortReply, longReply, nextSteps });
  }

  let drafted = false;
  let message = `📬 Gmail Scan: ${threads.length} threads\n`;
  for (const item of out) {
    message += `• From: ${item.thread.from} — Subject: ${item.thread.subject} — ${item.thread.threadUrl}\n${item.summary}\n`;
    if (item.nextSteps?.length) message += `Next: ${item.nextSteps.join('; ')}\n`;
    if (!drafted && item.shortReply) {
      const ok = await draftViaGAS(item.thread.threadId, item.shortReply);
      if (ok) {
        drafted = true;
        message += 'Draft created ✅\n';
      }
    }
  }

  await sendTelegram(message.trim());
}

processThreads().then(() => process.exit(0));
