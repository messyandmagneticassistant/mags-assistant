import type { NormalizedIntake, FulfillmentRecord, OrderSummary, FulfillmentOutput } from './types';
import { normalizeFromStripe, normalizeFromTally } from './intake';
import { generateBlueprint } from './blueprint';
import { buildIconBundle } from './icons';
import { makeScheduleKit } from './schedule';
import { deliverFulfillment } from './deliver';
import {
  ensureOrderWorkspace,
  appendFulfillmentLog,
  notifyOpsChannel,
  recordOrderSummary,
  loadFulfillmentConfig,
} from './common';
import { setLastOrderSummary } from '../queue';

export type OrderReference =
  | string
  | { kind: 'stripe-session'; sessionId: string; env?: any }
  | { kind: 'tally'; payload: any; env?: any }
  | { kind: 'intake'; intake: NormalizedIntake };

interface RunOptions {
  env?: any;
}

function formatFiles(record: FulfillmentRecord): string[] {
  return record.outputs.map((output) => `${output.label}: ${output.url}`).filter(Boolean);
}

function buildSummaryMetadata(record: FulfillmentRecord): Record<string, any> {
  return {
    bundle_fulfillment: 'complete',
    fulfillment_type: record.intake.fulfillmentType || 'digital',
    add_ons: record.intake.addOns || [],
    outputs: record.outputs.map((output) => ({ label: output.label, url: output.url, type: output.type })),
  };
}

async function updateNotion(record: FulfillmentRecord, env?: any) {
  const config = record.workspace.config;
  const databaseId = config.notionDatabaseId || process.env.FULFILLMENT_NOTION_DB_ID;
  const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY || env?.NOTION_TOKEN;
  if (!databaseId || !token) return;
  try {
    const { Client } = await import('@notionhq/client');
    const notion = new Client({ auth: token });
    const properties: Record<string, any> = {
      Name: { title: [{ text: { content: record.intake.customer.name || record.intake.email } }] },
      Email: { email: record.intake.email },
      Tier: { select: { name: record.intake.tier } },
      Status: { select: { name: 'Delivered' } },
      'Blueprint Doc': { url: record.blueprint.docUrl },
      'Blueprint PDF': { url: record.blueprint.pdfUrl },
      Icons: { url: record.icons.bundleFolderUrl },
      Schedule: { url: record.schedule.scheduleFolderUrl },
    };
    await notion.pages.create({
      parent: { database_id: databaseId },
      properties,
    });
  } catch (err) {
    console.warn('[fulfillment.runner] failed to update notion:', err);
  }
}

async function resolveIntake(ref: OrderReference, opts: RunOptions): Promise<NormalizedIntake> {
  if (typeof ref === 'string') {
    return normalizeFromStripe(ref, { env: opts.env });
  }
  if ('intake' in ref) return ref.intake;
  if (ref.kind === 'stripe-session') {
    return normalizeFromStripe(ref.sessionId, { env: ref.env || opts.env });
  }
  if (ref.kind === 'tally') {
    return normalizeFromTally(ref.payload, { env: ref.env || opts.env });
  }
  throw new Error('Unsupported order reference');
}

export async function runOrder(ref: OrderReference, opts: RunOptions = {}): Promise<FulfillmentRecord> {
  let intake = await resolveIntake(ref, opts);
  if (!intake.fulfillmentType) {
    intake = { ...intake, fulfillmentType: 'digital' };
  }
  let lastError: any = null;
  let record: FulfillmentRecord | null = null;
  const config = await loadFulfillmentConfig(opts);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const workspace = await ensureOrderWorkspace(intake, opts);
      const blueprint = await generateBlueprint(intake, { workspace });
      const icons = await buildIconBundle(intake, { workspace });
      const schedule = await makeScheduleKit(intake, { workspace });
      const deliveryResult = await deliverFulfillment(intake, blueprint, icons, schedule, {
        env: opts.env,
        workspace,
      });
      const delivery = deliveryResult.receipts;
      const outputs: FulfillmentOutput[] = deliveryResult.outputs;
      record = { intake, blueprint, icons, schedule, delivery, outputs, workspace };

      const summary: OrderSummary = {
        email: intake.email,
        tier: intake.tier,
        status: 'success',
        message: 'Delivered',
        completedAt: new Date().toISOString(),
        files: formatFiles(record),
        metadata: buildSummaryMetadata(record),
      };

      await appendFulfillmentLog(intake, summary, workspace.config);
      await recordOrderSummary(summary);
      await setLastOrderSummary(summary, opts.env);
      await updateNotion(record, opts.env);
      return record;
    } catch (err) {
      lastError = err;
      console.warn(`[fulfillment.runner] attempt ${attempt + 1} failed:`, err);
      if (attempt === 0) {
        try {
          intake = await resolveIntake({ kind: 'intake', intake }, opts);
          if (!intake.fulfillmentType) {
            intake = { ...intake, fulfillmentType: 'digital' };
          }
        } catch {}
        continue;
      }
    }
  }

  const summary: OrderSummary = {
    email: intake.email,
    tier: intake.tier,
    status: 'error',
    message: lastError?.message || 'Unknown failure',
    completedAt: new Date().toISOString(),
    files: [],
    metadata: {
      bundle_fulfillment: 'error',
      fulfillment_type: intake.fulfillmentType || 'digital',
      add_ons: intake.addOns || [],
    },
  };
  await appendFulfillmentLog(intake, summary, config);
  await recordOrderSummary(summary);
  await setLastOrderSummary(summary, opts.env);
  await notifyOpsChannel(`❌ Fulfillment failed for ${intake.email}: ${summary.message}`, config);
  throw lastError || new Error('Fulfillment failed');
}
