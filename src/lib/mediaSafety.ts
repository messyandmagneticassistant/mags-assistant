export interface SafetyReport {
  status: 'ok' | 'fixed' | 'rejected';
  reason?: string;
  link?: string;
  file?: string;
  path?: string;
}

export async function classifyFrame(_file: string): Promise<{ safe: boolean; [k: string]: any }> {
  return { safe: true };
}

export async function redactRegion(_file: string, _cls: any): Promise<void> {
  return;
}

export async function ensureSafe(file: string): Promise<SafetyReport> {
  return { status: 'ok', file };
}

export { ensureDefaults } from '../social/defaults';
