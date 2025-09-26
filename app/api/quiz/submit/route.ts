import { generateIconBundleFromReading } from '../../../../content/loader/blueprint';
import { createMagnetKit } from '../../../../lib/magnet-kit';
import { routeQuizSubmission } from '../../../../quiz/router';
import {
  exportCricutCutFile,
  type CricutExportBundle,
  type CricutCutSize,
} from '../../../../src/fulfillment/cricut';
import { slugify } from '../../../../utils/slugify';

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

  // 3b. Generate Cricut export if the user chose DIY magnets
  const formatChoice = String(body.formatChoice || body.format || '').toLowerCase();
  let cricut: Awaited<ReturnType<typeof exportCricutCutFile>> | null = null;
  if (formatChoice.includes('diy magnet')) {
    const requestedSizeRaw = body.cricutSize ?? body.magnetSize ?? body.size;
    const requestedSize =
      typeof requestedSizeRaw === 'string'
        ? Number.parseFloat(requestedSizeRaw)
        : typeof requestedSizeRaw === 'number'
        ? requestedSizeRaw
        : undefined;
    const validSize = [0.75, 1.25, 2].includes(requestedSize as number)
      ? (requestedSize as CricutCutSize)
      : undefined;

    const bundle: CricutExportBundle = {
      id: slugify(body.bundleId || `quiz-${userId}`),
      name: body.bundleName || 'DIY Magnet Bundle',
      household: body.household || route.household,
      icons: iconBundle.map((icon, index) => ({
        slug: slugify(icon.tag || `icon-${index + 1}`),
        label: icon.tag,
        description: (icon.categories || []).join(', '),
        tags: icon.categories || [],
      })),
    };

    try {
      cricut = await exportCricutCutFile(bundle, {
        size: validSize,
        includeLabels: body.includeLabels !== false,
        createLabelOverlay: body.labelOverlay === true || body.overlay === 'pdf',
        household: body.household || route.household,
      });
    } catch (err) {
      console.warn('[quiz.cricut] Failed to export Cricut cut file:', err);
    }
  }

  // 4. Stub saving to Notion/Drive and sending confirmations
  console.log('Save to Notion + Drive', { userId, iconBundle, kit, cricut });
  console.log('Send confirmation', { userId, route });

  return Response.json({ ok: true, iconBundle, kit, route, cricut });
}
