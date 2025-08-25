import { randomUUID } from 'crypto';
import { env } from './env.js';

// simple in-memory store to mimic Notion Command Center
const commands = [];

export function addCommand(command, args = '') {
  const entry = {
    id: randomUUID(),
    command,
    args,
    status: 'Pending',
    output: '',
    runNow: false,
    created: new Date(),
    updated: new Date(),
  };
  commands.push(entry);
  return entry;
}

export function getCommand(id) {
  return commands.find((c) => c.id === id);
}

export function listCommands() {
  return commands;
}

export function getPending() {
  return commands.filter(
    (c) => c.status === 'Pending' || c.runNow === true
  );
}

export function updateCommand(id, patch) {
  const c = getCommand(id);
  if (!c) return null;
  Object.assign(c, patch, { updated: new Date() });
  return c;
}

export function resetRunNow(id) {
  return updateCommand(id, { runNow: false });
}

export function ensureDb() {
  // placeholder for real Notion DB check/creation
  if (env.DRY_RUN || !env.NOTION_TOKEN) {
    return { id: 'local', created: false };
  }
  return { id: env.NOTION_STRIPE_DB_ID || 'unknown', created: false };
}
