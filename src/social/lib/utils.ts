export { ensureDefaults } from '../defaults';
export { pickVariant } from '../ab';
export { kvKeys, getJSON, setJSON } from '../kv';
export { classifyFrame, ensureSafe as baseEnsureSafe } from '../../lib/mediaSafety';

export async function ensureSafe(env: any, file: string) {
  return baseEnsureSafe(file);
}
