import { generateIconBundleFromReading } from '../../../../content/loader/blueprint';
import { createMagnetKit } from '../../../../lib/magnet-kit';
import { routeQuizSubmission } from '../../../../quiz/router';

export const runtime = 'nodejs';

/**
 * Handle quiz submissions. This is a lightweight orchestration layer
 * that triggers the reading and magnet kit generation pipelines. It
 * stubs external integrations (Notion, Drive, Telegram, Email).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as any;
  const userId = body.userId || 'anon';

  // 1. Generate icon bundle from reading data
  const iconBundle = generateIconBundleFromReading(body.reading || {});

  // 2. Build magnet kit using desired format and suggested icons
  const format = body.format || 'pdf';
  const kit = await createMagnetKit({
    userId,
    icons: iconBundle.map(i => i.tag),
    format,
  });

  // 3. Route the user to the correct product
  const route = routeQuizSubmission({
    household: body.household || 'Solo',
    format: body.formatChoice || 'Digital',
    tier: body.tier || 'Basic',
  });

  // 4. Stub saving to Notion/Drive and sending confirmations
  console.log('Save to Notion + Drive', { userId, iconBundle, kit });
  console.log('Send confirmation', { userId, route });

  return Response.json({ ok: true, iconBundle, kit, route });
}
