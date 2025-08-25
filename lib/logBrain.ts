import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

export interface BrainLogEntry {
  message: string;
  tiers?: string[] | string;
}

export function logBrain(entry: BrainLogEntry, context = 'local') {
  const filePath = path.join(process.cwd(), 'docs/.brain.md');
  let content = '';
  if (existsSync(filePath)) {
    content = readFileSync(filePath, 'utf8');
  }
  // Strip merge markers just in case
  content = content.replace(/^(<{7}|>{7}|={7}).*$/gm, '');

  const timestamp = new Date().toISOString();
  const header = `\n<!-- ${timestamp} | ${context} -->\n`;
  const tiersArr = Array.isArray(entry.tiers)
    ? entry.tiers
    : entry.tiers
    ? [entry.tiers]
    : ['General'];
  const tierText = tiersArr.join(', ');
  const line = `- (${tierText}) ${entry.message} — you are guided and supported.`;

  writeFileSync(filePath, content + header + line + '\n');
}

export default logBrain;
