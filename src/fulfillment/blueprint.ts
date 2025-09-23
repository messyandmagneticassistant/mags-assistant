import { Buffer } from 'buffer';
import type { docs_v1 } from 'googleapis';
import { ensureOrderWorkspace, ensureFolder, summarizeStory, notifyOpsChannel } from './common';
import type { NormalizedIntake, BlueprintResult, FulfillmentWorkspace, ModelAttempt } from './types';
import { runWithCodex } from '../../lib/codex';

async function callCodex(prompt: string): Promise<string> {
  const result = await runWithCodex({
    task: prompt,
    role: 'Soul blueprint composer',
    context:
      'Write vivid, grounded readings that feel handwritten by a caring guide. No AI disclaimers. Favor shorter sentences and avoid m-dashes.',
  });
  return result.trim();
}

async function callClaude(prompt: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('Missing ANTHROPIC_API_KEY');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1200,
      temperature: 0.6,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude error ${res.status}: ${JSON.stringify(json)}`);
  const text = json?.content?.[0]?.text || json?.content?.map?.((p: any) => p?.text)?.join('\n');
  if (!text) throw new Error('Claude returned empty response');
  return text.trim();
}

async function callGemini(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Missing GEMINI_API_KEY');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.5 },
      }),
    }
  );
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${JSON.stringify(json)}`);
  const text =
    json?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').join('\n').trim() || '';
  if (!text) throw new Error('Gemini returned empty response');
  return text;
}

function buildPrompt(intake: NormalizedIntake): string {
  const focus = intake.prefs?.focus || intake.prefs?.intention || 'support their natural rhythm';
  const name = intake.customer.name || intake.customer.firstName || 'this soul';
  const tierLabel = intake.tier === 'full' ? 'Full' : intake.tier === 'lite' ? 'Lite' : 'Mini';
  const birthParts: string[] = [];
  if (intake.customer.birth?.date) birthParts.push(`born ${intake.customer.birth.date}`);
  if (intake.customer.birth?.time) birthParts.push(`at ${intake.customer.birth.time}`);
  if (intake.customer.birth?.location) birthParts.push(`in ${intake.customer.birth.location}`);
  const birthLine = birthParts.length ? birthParts.join(' ') : 'birth data pending';
  const addons = intake.addOns.length ? `Add-ons: ${intake.addOns.join(', ')}.` : '';
  const preferenceSummary = Object.entries(intake.prefs || {})
    .filter(([key]) => !['email', 'productid', 'tier'].includes(key))
    .map(([key, value]) => `${key}: ${value}`)
    .slice(0, 12)
    .join('\n');

  return `You are writing a ${tierLabel} soul blueprint in a friendly, grounded, poetic tone. Avoid sounding robotic and do not use m-dashes.
Client: ${name}
Tier: ${tierLabel}
Birth: ${birthLine}
${addons}
Preferences:
${preferenceSummary || 'No additional notes.'}

Write a single cohesive story that weaves astrology, numerology, and subtle energy themes into a warm narrative. Include gentle suggestions for rhythm and rituals appropriate for their stage of life. Keep paragraphs short (3-4 sentences max) and emphasize encouragement.`;
}

async function generateStory(intake: NormalizedIntake): Promise<{ story: string; attempts: ModelAttempt[] }> {
  const prompt = buildPrompt(intake);
  const providers: Array<{
    id: ModelAttempt['provider'];
    fn: (prompt: string) => Promise<string>;
  }> = [
    { id: 'codex', fn: callCodex },
    { id: 'claude', fn: callClaude },
    { id: 'gemini', fn: callGemini },
  ];
  const attempts: ModelAttempt[] = [];
  for (const provider of providers) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const startedAt = new Date();
      try {
        const story = await provider.fn(prompt);
        attempts.push({
          provider: provider.id,
          ok: true,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
        });
        return { story, attempts };
      } catch (err: any) {
        attempts.push({
          provider: provider.id,
          ok: false,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          error: err?.message || String(err),
        });
      }
    }
  }
  throw Object.assign(new Error('All providers failed to generate blueprint'), { attempts });
}

async function insertStory(
  docs: docs_v1.Docs,
  documentId: string,
  story: string,
  intake: NormalizedIntake,
  workspace: FulfillmentWorkspace
) {
  const summary = summarizeStory(story, 180);
  const headerName = intake.customer.name || intake.customer.firstName || 'Beloved Soul';
  const tierLabel = intake.tier === 'full' ? 'Full' : intake.tier === 'lite' ? 'Lite' : 'Mini';
  const body = `${headerName} — ${tierLabel} Soul Blueprint\nGenerated ${workspace.timestamp.toLocaleString()}\n\n${story}\n\nHighlights: ${summary}`;
  const requests: docs_v1.Schema$Request[] = [
    { insertText: { location: { index: 1 }, text: body } },
  ];
  if (intake.customer.name) {
    requests.push({
      replaceAllText: {
        containsText: { text: '{{CLIENT_NAME}}', matchCase: false },
        replaceText: intake.customer.name,
      },
    });
  }
  requests.push({
    replaceAllText: {
      containsText: { text: '{{TIER}}', matchCase: false },
      replaceText: tierLabel,
    },
  });
  requests.push({
    replaceAllText: {
      containsText: { text: '{{BLUEPRINT_STORY}}', matchCase: false },
      replaceText: story,
    },
  });

  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests },
  });
}

export async function generateBlueprint(
  intake: NormalizedIntake,
  opts: { workspace?: FulfillmentWorkspace; env?: any } = {}
): Promise<BlueprintResult> {
  const workspace = opts.workspace || (await ensureOrderWorkspace(intake, opts));
  const { story, attempts } = await generateStory(intake).catch(async (err) => {
    await notifyOpsChannel(`⚠️ Blueprint story failed for ${intake.email}: ${err?.message || err}`, workspace.config);
    throw err;
  });

  const drive = workspace.drive;
  const docs = workspace.docs;
  const blueprintFolder = await ensureFolder(drive, workspace.orderFolderId, 'blueprint');
  const nameBase = `${intake.customer.name || intake.email || 'Soul Friend'} - Blueprint`;

  let docId: string;
  let docUrl = '';
  if (workspace.config.blueprintTemplateId) {
    const copy = await drive.files.copy({
      fileId: workspace.config.blueprintTemplateId,
      requestBody: {
        name: nameBase,
        parents: [blueprintFolder.id!],
      },
      fields: 'id, webViewLink',
    });
    docId = copy.data.id!;
    docUrl = copy.data.webViewLink || '';
  } else {
    const created = await docs.documents.create({ requestBody: { title: nameBase } });
    docId = created.data.documentId!;
    await drive.files.update({ fileId: docId, addParents: blueprintFolder.id!, fields: 'id, webViewLink' });
    const meta = await drive.files.get({ fileId: docId, fields: 'webViewLink' });
    docUrl = meta.data.webViewLink || '';
  }

  await insertStory(docs, docId, story, intake, workspace);

  const exportRes = await drive.files.export(
    { fileId: docId, mimeType: 'application/pdf' },
    { responseType: 'arraybuffer' }
  );
  const pdfBuffer = Buffer.from(exportRes.data as ArrayBuffer);
  const pdf = await drive.files.create({
    requestBody: {
      name: `${nameBase}.pdf`,
      mimeType: 'application/pdf',
      parents: [blueprintFolder.id!],
    },
    media: { mimeType: 'application/pdf', body: pdfBuffer },
    fields: 'id, webViewLink',
  });

  const summary = summarizeStory(story, 240);
  return {
    docId,
    docUrl,
    pdfId: pdf.data.id || '',
    pdfUrl: pdf.data.webViewLink || '',
    summary,
    story,
    attempts,
    folderId: blueprintFolder.id!,
    folderUrl: blueprintFolder.webViewLink || '',
  };
}
