// src/fundraising/email.ts
import { readFileSync } from 'fs';
import path from 'path';

function mdToHtml(md: string): string {
  return md
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/\n\n/g, '<br><br>');
}

const templateCache: Record<string, string> = {};

function loadTemplate(name: string): string {
  if (!templateCache[name]) {
    const file = path.join(path.dirname(new URL(import.meta.url).pathname), 'templates', `${name}.md`);
    templateCache[name] = readFileSync(file, 'utf8');
  }
  return templateCache[name];
}

export function renderTemplate(name: string, vars: Record<string, string>): string {
  const raw = loadTemplate(name);
  const text = raw.replace(/\{\{(.*?)\}\}/g, (_, k) => vars[k.trim()] || '');
  return mdToHtml(text);
}

export const subjects = {
  outreach: 'Partner on a healing & ecological retreat in {{landTown}}?',
  followup: 'Quick nudge on our retreat project',
};
