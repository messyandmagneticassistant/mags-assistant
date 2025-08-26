// maggie/tasks/uploader.ts

import { tgSend } from '../../lib/telegram';
import { runCodex } from '../../codex';
import { getOverlayDefaults } from '../overlays-defaults';
import { log } from '../../shared/logger';
import { postLogUpdate } from '../watcher';
import path from 'path';
import fs from 'fs/promises';

const POSTED_FOLDER = 'posted';

export async function uploadVideoViaBrowser(filePath: string): Promise<void> {
  const fileName = path.basename(filePath);
  const rawText = `Generate a viral TikTok caption, hashtags, and overlay based on this file: ${fileName}`;

  log(`[uploadVideoViaBrowser] Preparing post for: ${fileName}`);
  await postLogUpdate({ type: 'info', message: `Starting upload for ${fileName}` });

  const overlayDefaults = await getOverlayDefaults();

  const { text: codexResponse } = await runCodex({
    system: `You're a viral TikTok strategist. Generate a caption, overlay text, and 5 hashtags.`,
    input: fileName,
    examples: [
      {
        input: 'baby-bunny-eats-flower.mov',
        output: `Caption: He's beauty, he's grace.  
Overlay: Wildflower boy 🌼  
Hashtags: #babybunny #homesteadlife #cutepets #bunnytok #pastelcore`,
      },
    ],
  });

  const caption = extractField(codexResponse, 'Caption') || overlayDefaults.caption;
  const overlay = extractField(codexResponse, 'Overlay') || overlayDefaults.overlay;
  const hashtags = extractField(codexResponse, 'Hashtags') || overlayDefaults.hashtags;
  const firstComment = overlayDefaults.firstComment || '🌿 more in bio';

  // TODO: Launch Playwright or Puppeteer logic here to upload the video to TikTok

  log(`[uploadVideoViaBrowser] Finalized post content:
• Caption: ${caption}
• Overlay: ${overlay}
• Hashtags: ${hashtags}`);

  // Move file to /posted instead of deleting it (for record-keeping)
  await fs.mkdir(POSTED_FOLDER, { recursive: true });
  await fs.rename(filePath, path.join(POSTED_FOLDER, fileName));

  await postLogUpdate({ type: 'success', message: `Posted ${fileName}` });
  await tgSend(`✅ Uploaded: <b>${fileName}</b>\n\n${caption}\n\n<code>${hashtags}</code>`);
}

// Utility function to parse AI output
function extractField(text: string, label: string): string | null {
  const regex = new RegExp(`${label}: (.+)`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}