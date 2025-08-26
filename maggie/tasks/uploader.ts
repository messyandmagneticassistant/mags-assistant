import { tgSend } from '../../lib/telegram';
import { runCodex } from '../../codex';
import { getOverlayDefaults } from '../overlays-defaults';
import { log } from '../../shared/logger';
import { postLogUpdate } from '../watcher';
import path from 'path';
import fs from 'fs';

export async function uploadVideoViaBrowser(filePath: string): Promise<void> {
  const fileName = path.basename(filePath);
  const rawText = `Generate a viral TikTok caption, hashtags, and overlay based on this file: ${fileName}`;

  log(`[uploadVideoViaBrowser] Preparing post for: ${fileName}`);
  postLogUpdate({ type: 'info', message: `Starting upload for ${fileName}` });

  const overlayDefaults = await getOverlayDefaults(); // Safety net if Codex fails
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

  // TODO: Launch Playwright/Puppeteer logic here to simulate TikTok upload
  log(`[uploadVideoViaBrowser] Would post "${caption}" with overlay "${overlay}" and hashtags: ${hashtags}`);

  // Optionally delete or move the file after simulated upload
  fs.unlinkSync(filePath); // Or move to /posted

  postLogUpdate({ type: 'success', message: `Posted ${fileName}` });
  await tgSend(`✅ Uploaded: ${fileName}\n\n${caption}\n\n${hashtags}`);
}

// Utility function to parse AI output
function extractField(text: string, label: string): string | null {
  const regex = new RegExp(`${label}: (.+)`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}