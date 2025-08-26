import { CaptionOptions } from '../types';
import { queryGemini } from '../utils/gemini';

export async function generateOverlay(options: CaptionOptions): Promise<string> {
  const { persona = 'main', videoTheme = 'general', tone = 'authentic' } = options;

  const prompt = `
You are helping the creator "${persona}" write on-screen overlay text for a TikTok video.

• Video Theme: ${videoTheme}
• Tone: ${tone}

This overlay should:
- Be short and punchy (under 60 characters)
- Be readable on screen (ideal for subtitles or title overlays)
- Match the creator's tone
- Be emotionally resonant, funny, or meaningful — not boring
- Avoid quotes or emojis unless absolutely necessary

Just give the final overlay line. No explanation.
`;

  const response = await queryGemini(prompt);
  return (response || '').trim();
}