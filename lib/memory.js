import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

const root = process.cwd();
const memoryPath = path.join(root, 'brain', 'memory.json');
const logPath = path.join(root, 'brain', 'learning_log.json');

export function loadMemory() {
  try {
    const data = readFileSync(memoryPath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

export function saveMemory(memory) {
  try {
    writeFileSync(memoryPath, JSON.stringify(memory, null, 2));
    return true;
  } catch (e) {
    return false;
  }
}

export function appendMemory(section, item) {
  const memory = loadMemory();
  if (!memory[section]) memory[section] = [];
  memory[section].push(item);
  saveMemory(memory);
  logLearning({ action: 'append', section, item });
  return memory;
}

export function logLearning(entry) {
  let log = [];
  if (existsSync(logPath)) {
    try {
      log = JSON.parse(readFileSync(logPath, 'utf8'));
      if (!Array.isArray(log)) log = [];
    } catch (e) {
      log = [];
    }
  }
  log.push({ ts: new Date().toISOString(), ...entry });
  writeFileSync(logPath, JSON.stringify(log, null, 2));
  return log;
}
