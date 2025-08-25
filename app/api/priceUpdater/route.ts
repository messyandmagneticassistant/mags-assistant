export const runtime = 'nodejs';

import { runPriceUpdater } from '../../../lib/price-updater';

export async function GET() {
  const result = await runPriceUpdater();
  return Response.json(result);
}
