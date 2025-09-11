// src/fundraising/index.ts

export type Contact = {
  org?: string;
  name: string;
  email: string;
  notes?: string;
};

export type SubmissionLog = {
  org: string;
  program: string;
  url: string;
  submittedAt: string;
  status: string;
  notes?: string;
};

export async function addContact(info: Contact): Promise<boolean> {
  console.log('[fundraising] addContact', info);
  return true;
}

export async function logSubmission(info: SubmissionLog): Promise<boolean> {
  console.log('[fundraising] logSubmission', info);
  return true;
}

export async function saveFile({ name, mime, base64 }: { name: string; mime: string; base64: string; }): Promise<string> {
  console.log('[fundraising] saveFile', name, mime, base64.length);
  return `https://drive.example/${encodeURIComponent(name)}`;
}

export async function updateNotionSummary(data: Record<string, any>): Promise<boolean> {
  console.log('[fundraising] updateNotionSummary', data);
  return true;
}

export async function createOnePager({ data }: { data: Record<string, any>; }): Promise<string> {
  console.log('[fundraising] createOnePager', data);
  return 'https://drive.example/onepager.pdf';
}

export async function sendEmail({ to, subject, html, attachments }: { to: string; subject: string; html: string; attachments?: any[]; }): Promise<boolean> {
  console.log('[fundraising] sendEmail', { to, subject, html: html.slice(0, 40), attachments });
  return true;
}

export async function runQueuedOutreach(env: any): Promise<void> {
  try {
    const url = (env.WORKER_URL || '') + '/fundraising/outreach';
    await fetch(url, { method: 'POST', headers: { 'x-api-key': env.CRON_SECRET || '' }, body: JSON.stringify({ contacts: [] }) });
  } catch (err) {
    console.error('runQueuedOutreach failed', err);
  }
}
