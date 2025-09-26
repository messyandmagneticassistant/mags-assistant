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
  const blankCount = icons.icons.filter((icon) => icon.slug.startsWith('blank-fill-in')).length;
  const blankNote = blankCount
    ? ` (includes ${blankCount} blank ${blankCount === 1 ? 'magnet' : 'magnets'} for custom routines)`
    : '';
  const bundleLine = icons.bundleName
    ? `- Icon bundle (${icons.bundleName}): ${icons.bundleFolderUrl}${blankNote}`
    : `- Icon bundle: ${icons.bundleFolderUrl}${blankNote}`;
  const textBody = `${greeting},

Your reading and rhythm kit are ready. Here is everything in one place:
- Story in Google Docs: ${blueprint.docUrl}
- Downloadable PDF: ${blueprint.pdfUrl}
- Rhythm templates: ${schedule.scheduleFolderUrl}
${bundleLine}

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
    <li><a href="${icons.bundleFolderUrl}">Icon bundle${icons.bundleName ? ` (${icons.bundleName})` : ''}</a>${
      blankCount ? ` – includes ${blankCount} blank ${blankCount === 1 ? 'magnet' : 'magnets'} to fill in yourself` : ''
    }</li>
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
