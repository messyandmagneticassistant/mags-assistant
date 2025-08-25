export async function runWithGemini({
  agentName = 'Maggie',
  role = 'Soul Blueprint + TikTok Automation Assistant',
  context = `You are a full-stack AI assistant managing soul readings, magnet kits, content strategy, TikTok growth, family scheduling, and spiritual business operations. You work across back-end and front-end systems like Stripe, Notion, Tally, TikTok, and Google Drive.`,
  task,
  fallbackToAppsScript = true
}: {
  agentName?: string
  role?: string
  context?: string
  task: string
  fallbackToAppsScript?: boolean
}) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey && !fallbackToAppsScript) {
    // Direct Gemini API via REST (generativelanguage.googleapis.com)
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: `${context}\n\nTask: ${task}` }],
              role: 'user'
            }
          ]
        })
      }
    );

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text || '[No output from Gemini API]';
  }

  // Fallback to Google Apps Script cloud endpoint
  const res = await fetch('https://script.google.com/macros/s/AKfycbxjJba92V4wLjciKk6y-oZ-g9JYNOCC1RDhFwWLHEnbztMJGHDC0cphwgGU3HbPi1hjiA/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName, role, context, task })
  });

  const data = await res.json();
  return data.output || '[No output from Apps Script Gemini]';
}