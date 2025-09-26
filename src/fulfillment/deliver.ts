import { sendEmail } from '../../utils/email';
import type { NormalizedIntake, BlueprintResult, IconBundleResult, ScheduleResult, DeliveryReceipt } from './types';

interface DeliverOptions {
  env?: any;
}

export async function deliverFulfillment(
  intake: NormalizedIntake,
  blueprint: BlueprintResult,
  icons: IconBundleResult,
  schedule: ScheduleResult,
  opts: DeliverOptions = {}
): Promise<DeliveryReceipt[]> {
  if (!intake.email) {
    throw new Error('Cannot deliver fulfillment without customer email');
  }

  const subject = `Your ${intake.tier === 'full' ? 'Full' : intake.tier === 'lite' ? 'Lite' : 'Mini'} Soul Blueprint is here`;
  const greeting = intake.customer.firstName || intake.customer.name || 'Hi friend';
  const bundleLine = icons.bundleName
    ? `- Icon bundle (${icons.bundleName}): ${icons.bundleFolderUrl}`
    : `- Icon bundle: ${icons.bundleFolderUrl}`;
  const layoutLines = icons.layout
    ? [
        `- Printable layout PDF: ${icons.layout.pdfUrl}`,
        `- SVG for Cricut: ${icons.layout.svgUrl}`,
        icons.layout.pngUrl ? `- PNG fallback: ${icons.layout.pngUrl}` : undefined,
      ].filter((value): value is string => Boolean(value))
    : [];

  const textBody = `${greeting},

Your reading and rhythm kit are ready. Here is everything in one place:
- Story in Google Docs: ${blueprint.docUrl}
- Downloadable PDF: ${blueprint.pdfUrl}
- Rhythm templates: ${schedule.scheduleFolderUrl}
${bundleLine}
${layoutLines.length ? layoutLines.join('\n') + '\n' : ''}
Take your time, sip some tea, and let this settle in. Reply if anything feels off or if you want an adjustment.

With warmth,
Maggie`;

  const htmlBody = `
  <p>${greeting},</p>
  <p>Your reading and rhythm kit are ready. Here is everything in one place:</p>
  <ul>
    <li><a href="${blueprint.docUrl}">Story in Google Docs</a></li>
    <li><a href="${blueprint.pdfUrl}">Downloadable PDF</a></li>
    <li><a href="${schedule.scheduleFolderUrl}">Rhythm templates</a></li>
    <li><a href="${icons.bundleFolderUrl}">Icon bundle${icons.bundleName ? ` (${icons.bundleName})` : ''}</a></li>
${
  icons.layout
    ? [`    <li><a href="${icons.layout.pdfUrl}">Printable layout (PDF)</a></li>`, `    <li><a href="${icons.layout.svgUrl}">SVG for Cricut</a></li>`]
        .concat(icons.layout.pngUrl ? [`    <li><a href="${icons.layout.pngUrl}">PNG fallback</a></li>`] : [])
        .join('\n')
    : ''
}
  </ul>
  <p>Take your time, sip some tea, and let this settle in. Reply if anything feels off or if you want an adjustment.</p>
  <p>With warmth,<br/>Maggie</p>
  `;

  const result = await sendEmail(
    {
      to: intake.email,
      subject,
      text: textBody,
      html: htmlBody,
    },
    opts.env
  );

  return [{ channel: 'email', id: result.id }];
}
