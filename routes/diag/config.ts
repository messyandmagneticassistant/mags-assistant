import type { Env } from '../../worker/lib/env';
import { handleDiagConfig } from '../../worker/diag';

export async function onRequestGet({ env }: { env: Env }) {
  return handleDiagConfig(env);
}
