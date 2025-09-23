import { Buffer } from 'buffer';
import { ensureOrderWorkspace, ensureFolder } from './common';
import type { NormalizedIntake, ScheduleResult, ScheduleFile, FulfillmentWorkspace } from './types';
import type { docs_v1 } from 'googleapis';

interface ScheduleContent {
  headline: string;
  body: string;
}

type ScheduleKind = 'daily' | 'weekly' | 'monthly';

function buildDailyContent(intake: NormalizedIntake): ScheduleContent {
  const name = intake.customer.firstName || intake.customer.name || 'your';
  const morning = intake.prefs?.morning_focus || 'open with breath, water, and simple alignment practice';
  const midday = intake.prefs?.midday_focus || 'focus block for creative or service work';
  const evening = intake.prefs?.evening_focus || 'soft landing with reflection and rest';
  const anchors = [
    { time: '7:30a', focus: morning },
    { time: '12:30p', focus: midday },
    { time: '4:30p', focus: 'transition ritual to close loops and celebrate wins' },
    { time: '9:00p', focus: evening },
  ];
  const lines = anchors.map((slot) => `• ${slot.time} — ${slot.focus}`);
  return {
    headline: `${name} daily rhythm`,
    body: `Morning intention: ${morning}\nMidday anchor: ${midday}\nEvening ease: ${evening}\n\nSuggested cadence:\n${lines.join('\n')}`,
  };
}

function buildWeeklyContent(intake: NormalizedIntake): ScheduleContent {
  const themes = intake.prefs?.themes || intake.prefs?.focus || 'visibility, nourishment, community';
  const resets = intake.prefs?.reset_day || 'Sunday';
  const share = intake.prefs?.share_channels || 'email newsletter, social drop, personal outreach';
  const week = [
    { day: 'Monday', focus: 'vision + planning pulse' },
    { day: 'Wednesday', focus: 'creation + delivery' },
    { day: 'Friday', focus: 'celebration + check-in' },
  ];
  const lines = week.map((entry) => `• ${entry.day}: ${entry.focus}`);
  return {
    headline: 'Weekly wave',
    body: `Key themes: ${themes}\nReset day: ${resets}\nShare / broadcast: ${share}\n\nWeekly arc:\n${lines.join('\n')}`,
  };
}

function buildMonthlyContent(intake: NormalizedIntake): ScheduleContent {
  const focus = intake.prefs?.season_focus || 'seasonal story, sales pulse, community care';
  const rituals = intake.prefs?.rituals || 'new moon mapping, full moon gratitude, seasonal clean sweep';
  const review = intake.prefs?.review || 'metrics + feeling check, client notes, offer refinement';
  return {
    headline: 'Monthly / seasonal cadence',
    body: `Focus of the month: ${focus}\nRitual anchors: ${rituals}\nReview + integration: ${review}`,
  };
}

function buildScheduleContent(intake: NormalizedIntake, kind: ScheduleKind): ScheduleContent {
  if (kind === 'daily') return buildDailyContent(intake);
  if (kind === 'weekly') return buildWeeklyContent(intake);
  return buildMonthlyContent(intake);
}

async function writeScheduleDoc(
  kind: ScheduleKind,
  content: ScheduleContent,
  workspace: FulfillmentWorkspace,
  docs: docs_v1.Docs,
  scheduleFolderId: string,
  templateId?: string
): Promise<ScheduleFile> {
  const drive = workspace.drive;
  const nameBase = `${workspace.timestamp.toISOString().slice(0, 10)} - ${content.headline}`;
  let docId: string;
  let docUrl = '';
  if (templateId) {
    const copy = await drive.files.copy({
      fileId: templateId,
      requestBody: {
        name: nameBase,
        parents: [scheduleFolderId],
      },
      fields: 'id, webViewLink',
    });
    docId = copy.data.id!;
    docUrl = copy.data.webViewLink || '';
  } else {
    const created = await docs.documents.create({ requestBody: { title: nameBase } });
    docId = created.data.documentId!;
    await drive.files.update({ fileId: docId, addParents: scheduleFolderId, fields: 'id, webViewLink' });
    const meta = await drive.files.get({ fileId: docId, fields: 'webViewLink' });
    docUrl = meta.data.webViewLink || '';
  }

  const body = `${content.headline}\nGenerated ${workspace.timestamp.toLocaleString()}\n\n${content.body}`;
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        { insertText: { location: { index: 1 }, text: body } },
        {
          replaceAllText: {
            containsText: { text: '{{SCHEDULE_BODY}}', matchCase: false },
            replaceText: content.body,
          },
        },
      ],
    },
  });

  const exportRes = await drive.files.export(
    { fileId: docId, mimeType: 'application/pdf' },
    { responseType: 'arraybuffer' }
  );
  const pdfBuffer = Buffer.from(exportRes.data as ArrayBuffer);
  const pdf = await drive.files.create({
    requestBody: {
      name: `${content.headline}.pdf`,
      mimeType: 'application/pdf',
      parents: [scheduleFolderId],
    },
    media: { mimeType: 'application/pdf', body: pdfBuffer },
    fields: 'id, webViewLink',
  });

  return {
    type: kind,
    headline: content.headline,
    docId,
    docUrl,
    pdfId: pdf.data.id || '',
    pdfUrl: pdf.data.webViewLink || '',
  };
}

export async function makeScheduleKit(
  intake: NormalizedIntake,
  opts: { workspace?: FulfillmentWorkspace; env?: any } = {}
): Promise<ScheduleResult> {
  const workspace = opts.workspace || (await ensureOrderWorkspace(intake, opts));
  const drive = workspace.drive;
  const docs = workspace.docs;
  const scheduleFolder = await ensureFolder(drive, workspace.orderFolderId, 'schedule');

  const kinds: ScheduleKind[] = ['daily'];
  if (intake.tier !== 'mini') kinds.push('weekly');
  if (intake.tier === 'full') kinds.push('monthly');

  const files: ScheduleFile[] = [];
  for (const kind of kinds) {
    const templateId = workspace.config.scheduleTemplates?.[kind];
    const content = buildScheduleContent(intake, kind);
    const file = await writeScheduleDoc(kind, content, workspace, docs, scheduleFolder.id!, templateId);
    files.push(file);
  }

  return {
    scheduleFolderId: scheduleFolder.id!,
    scheduleFolderUrl: scheduleFolder.webViewLink || '',
    files,
  };
}
