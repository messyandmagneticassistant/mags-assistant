import { kvKeys as socialKvKeys, getJSON, setJSON } from '../social/kv';

export const kvKeys = { ...socialKvKeys, ledger: 'social:ledger:last' } as const;

export { getJSON, setJSON };
