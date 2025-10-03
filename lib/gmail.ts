import { google } from 'googleapis';
import { requireEnv } from './env.js';
import { fetchGoogleKey } from './google-key.js';

interface GmailPayload {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

async function getAuth() {
  const client_email = requireEnv('GOOGLE_CLIENT_EMAIL');
  const private_key = (await fetchGoogleKey()).replace(/\\n/g, '\n');
  return new google.auth.JWT(client_email, undefined, private_key, [
    'https://www.googleapis.com/auth/gmail.send',
  ]);
}

function buildMimeMessage({ to, subject, text, html }: GmailPayload): string {
  const safeText = text ?? '';
  const safeHtml = html ?? '';
  const hasHtml = Boolean(html);

  if (!hasHtml) {
    return [
      `To: ${to}`,
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${subject}`,
      '',
      safeText,
    ].join('\n');
  }

  const boundary = 'mixed-boundary';
  return [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    '',
    safeText,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    '',
    safeHtml,
    '',
    `--${boundary}--`,
    '',
  ].join('\n');
}

export async function sendEmail(payload: GmailPayload) {
  const auth = await getAuth();
  const gmail = google.gmail({ version: 'v1', auth });
  const message = buildMimeMessage(payload);
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
  });
  return res.data;
}
