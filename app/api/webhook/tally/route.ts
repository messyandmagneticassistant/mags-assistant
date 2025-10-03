import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { appendRows } from '../../../../lib/google';
import { logErrorToSheet } from '../../../../lib/maggieLogs';
import { updateWebhookStatus } from '../../../../lib/statusStore';
import { normalizeFromTally } from '../../../../src/fulfillment/intake';
import { runOrder } from '../../../../src/fulfillment/runner';

export const runtime = 'nodejs';

function parseSignatureHeader(header: string | null): { timestamp: string; signature: string } | null {
  if (!header) return null;
  let timestamp = '';
  let signature = '';
  for (const part of header.split(',')) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value || '';
    if (key === 'v1') signature = value || '';
  }
  if (!timestamp || !signature) return null;
  return { timestamp, signature };
}

function verifyTallySignature(raw: string, header: string | null, secret: string): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${parsed.timestamp}.${raw}`);
  const digest = hmac.digest('hex');
  const received = Buffer.from(parsed.signature, 'hex');
  const expected = Buffer.from(digest, 'hex');
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(received, expected);
}

async function forwardToAppsScript(raw: string, req: NextRequest): Promise<boolean> {
  const url = process.env.GAS_INTAKE_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': req.headers.get('content-type') || 'application/json',
        'x-maggie-forwarded': 'tally',
      },
      body: raw,
    });
    return res.ok;
  } catch (err) {
    console.warn('[webhook.tally] failed to forward to Apps Script:', err);
    return false;
  }
}

function pick(...values: Array<string | undefined | null>): string {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return '';
}

async function logToSheets(body: any): Promise<boolean> {
  const sheetId =
    process.env.TALLY_RESPONSE_SHEET_ID ||
    process.env.MAGGIE_LOG_SHEET_ID ||
    process.env.GOOGLE_SHEET_ID;
  if (!sheetId) return false;
  const data: Record<string, any> = body?.data || body || {};
  const row = [
    new Date().toISOString(),
    body?.formId || body?.form_id || '',
    body?.submissionId || body?.submission_id || '',
    data.email || '',
    pick(data.name, `${data.first_name || ''} ${data.last_name || ''}`.trim()),
    pick(data.tier, data.package, data.selection, data.product_choice, data.productId),
    pick(data.birthdate, data.birth_date, data.dob),
    pick(data.birthtime, data.birth_time),
    pick(data.birthplace, data.birth_place, data.location),
    JSON.stringify(data),
  ];
  try {
    await appendRows(sheetId, "'TallyResponses'!A:J", [row]);
    return true;
  } catch (err) {
    console.warn('[webhook.tally] failed to append to sheet:', err);
    return false;
  }
}

function hasSoulData(intake: Awaited<ReturnType<typeof normalizeFromTally>>): boolean {
  const birth = intake.customer?.birth || {};
  return Boolean(intake.tier && birth.date);
}

export async function POST(req: NextRequest) {
  const startedAt = new Date().toISOString();
  const secret = process.env.TALLY_SIGNING_SECRET || process.env.TALLY_WEBHOOK_SECRET;
  const raw = await req.text();

  if (secret) {
    const ok = verifyTallySignature(raw, req.headers.get('tally-signature'), secret);
    if (!ok) {
      await updateWebhookStatus('tally', {
        lastFailureAt: startedAt,
        error: 'invalid signature',
      });
      return new NextResponse('invalid signature', { status: 401 });
    }
  }

  let body: any;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch (err) {
    await updateWebhookStatus('tally', {
      lastFailureAt: startedAt,
      error: 'invalid json',
    });
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const [forwarded, logged] = await Promise.all([
    forwardToAppsScript(raw, req),
    logToSheets(body),
  ]);

  let normalized;
  try {
    normalized = await normalizeFromTally(body);
  } catch (err) {
    await Promise.all([
      logErrorToSheet({ module: 'TallyWebhook', error: err, timestamp: startedAt }),
      updateWebhookStatus('tally', {
        lastFailureAt: startedAt,
        error: err instanceof Error ? err.message : String(err),
      }),
    ]);
    return NextResponse.json({ ok: false, error: 'normalization failed' }, { status: 500 });
  }

  let readingTriggered = false;
  let readingSkippedReason: string | undefined;

  if (hasSoulData(normalized)) {
    try {
      await runOrder({ kind: 'intake', intake: normalized });
      readingTriggered = true;
    } catch (err) {
      await Promise.all([
        logErrorToSheet({ module: 'TallyWebhook', error: err, timestamp: startedAt }),
        updateWebhookStatus('tally', {
          lastFailureAt: startedAt,
          error: err instanceof Error ? err.message : String(err),
        }),
      ]);
      return NextResponse.json({ ok: false, error: 'fulfillment failed' }, { status: 500 });
    }
  } else {
    readingSkippedReason = 'missing soul data';
  }

  await updateWebhookStatus('tally', {
    lastSuccessAt: new Date().toISOString(),
    error: null,
  });

  return NextResponse.json({
    ok: true,
    forwarded,
    logged,
    readingTriggered,
    readingSkippedReason,
  });
}
