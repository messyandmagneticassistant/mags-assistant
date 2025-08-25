import { google } from 'googleapis';
import { requireEnv } from './env.js';
import { fetchGoogleKey } from './google-key.js';

async function getAuth() {
  const client_email = requireEnv('GOOGLE_CLIENT_EMAIL');
  const private_key = (await fetchGoogleKey()).replace(/\\n/g, '\n');
  return new google.auth.JWT(client_email, undefined, private_key, [
    'https://www.googleapis.com/auth/gmail.send'
  ]);
}

export async function sendEmail({ to, subject, text }: { to: string; subject: string; text: string }) {
  const auth = await getAuth();
  const gmail = google.gmail({ version: 'v1', auth });
  const message = [
    `To: ${to}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    '',
    text,
  ].join('\n');
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
