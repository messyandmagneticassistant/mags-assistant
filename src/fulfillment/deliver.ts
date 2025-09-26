import { sendEmail } from '../../utils/email';
import { loadFulfillmentConfig } from './common';
import { tgSend } from '../lib/telegram';
import type {
  NormalizedIntake,
  BlueprintResult,
  IconBundleResult,
  ScheduleResult,
  DeliveryReceipt,
  FulfillmentOutput,
  FulfillmentWorkspace,
  FulfillmentMode,
} from './types';

interface DeliverOptions {
  env?: any;
  workspace?: FulfillmentWorkspace;
}

interface DeliveryResult {
  receipts: DeliveryReceipt[];
  outputs: FulfillmentOutput[];
}

function describeFulfillment(mode: FulfillmentMode | undefined): string {
  switch (mode) {
    case 'physical':
      return 'print-ready magnet bundle';
    case 'cricut-ready':
      return 'Cricut-ready design kit';
    default:
      return 'digital bundle';
  }
}

function buildOutputs(
  intake: NormalizedIntake,
  blueprint: BlueprintResult,
  icons: IconBundleResult,
  schedule: ScheduleResult
): FulfillmentOutput[] {
  const outputs: FulfillmentOutput[] = [];
  if (blueprint.docUrl) {
    outputs.push({ label: 'Story in Google Docs', url: blueprint.docUrl, type: 'document' });
  }

  const fulfillmentType = intake.fulfillmentType || 'digital';
  const pdfLabel =
    fulfillmentType === 'physical'
      ? 'Print-ready magnet PDF'
      : fulfillmentType === 'cricut-ready'
      ? 'Cricut instructions PDF'
      : 'Digital instructions PDF';
  if (blueprint.pdfUrl) {
    outputs.push({ label: pdfLabel, url: blueprint.pdfUrl, type: 'pdf' });
  }

  if (schedule.scheduleFolderUrl) {
    outputs.push({ label: 'Rhythm templates', url: schedule.scheduleFolderUrl, type: 'schedule' });
  }

  if (icons.bundleFolderUrl) {
    const iconLabel =
      fulfillmentType === 'cricut-ready' ? 'SVG + PNG design bundle' : 'Icon bundle';
    outputs.push({ label: iconLabel, url: icons.bundleFolderUrl, type: 'icons' });
  }

  if (fulfillmentType === 'cricut-ready' && icons.manifestUrl) {
    outputs.push({ label: 'Cutting manifest', url: icons.manifestUrl, type: 'asset' });
  }

  return outputs;
}

function formatTextOutputs(outputs: FulfillmentOutput[]): string {
  return outputs
    .map((output) => `- ${output.label}: ${output.url}`)
    .join('\n');
}

function formatHtmlOutputs(outputs: FulfillmentOutput[]): string {
  return outputs
    .map((output) => `<li><a href="${output.url}">${output.label}</a></li>`)
    .join('');
}

export async function deliverFulfillment(
  intake: NormalizedIntake,
  blueprint: BlueprintResult,
  icons: IconBundleResult,
  schedule: ScheduleResult,
  opts: DeliverOptions = {}
): Promise<DeliveryResult> {
  if (!intake.email) {
    throw new Error('Cannot deliver fulfillment without customer email');
  }

  let config = opts.workspace?.config;
  if (!config) {
    try {
      config = await loadFulfillmentConfig({ env: opts.env });
    } catch (err) {
      console.warn('[fulfillment.deliver] unable to load config for delivery:', err);
    }
  }
  const outputs = buildOutputs(intake, blueprint, icons, schedule);
  const fulfillmentLabel = describeFulfillment(intake.fulfillmentType);
  const addOnSummary = intake.addOns?.length ? intake.addOns.join(', ') : 'None';
  const subject = `Your ${fulfillmentLabel} is ready`;
  const greeting = intake.customer.firstName || intake.customer.name || 'Hi friend';
  const textBody = `${greeting},

Your ${fulfillmentLabel} is ready. Here is everything in one place:
${formatTextOutputs(outputs)}

Add-ons: ${addOnSummary}

Take your time, sip some tea, and let this settle in. Reply if anything feels off or if you want an adjustment.

With warmth,
Maggie`;

  const htmlBody = `
  <p>${greeting},</p>
  <p>Your ${fulfillmentLabel} is ready. Here is everything in one place:</p>
  <ul>
    ${formatHtmlOutputs(outputs)}
  </ul>
  <p>Add-ons: <strong>${addOnSummary}</strong></p>
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

  const receipts: DeliveryReceipt[] = [{ channel: 'email', id: result.id }];

  if (config?.telegramChatId && config.telegramBotToken) {
    const telegramMessage = `✨ ${fulfillmentLabel} sent to ${intake.email}\nAdd-ons: ${addOnSummary}\n${formatTextOutputs(outputs)}`;
    try {
      await tgSend(telegramMessage, config.telegramChatId);
      receipts.push({ channel: 'telegram', target: config.telegramChatId });
    } catch (err) {
      console.warn('[fulfillment.deliver] failed to notify via Telegram:', err);
    }
  }

  return { receipts, outputs };
}
