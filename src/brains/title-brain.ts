import { CaptionOptions } from '../types';
import { queryGemini } from '../utils/gemini'; // adjust path if needed

export async function generateTitle(options: CaptionOptions): Promise<string> {
  const { persona = 'main', videoTheme = 'general', overlayText = '', tone = 'authentic' } = options;

  const prompt = `
You're a TikTok strategist helping the creator "${persona}" generate a short, catchy, non-cringe title for a video.

• Video Theme: ${videoTheme}
• Overlay Text: ${overlayText}
• Tone: ${tone}

The title should:
- Be natural and human (no weird AI vibes)
- Feel like a real person would say it
- Avoid quotes, emojis, and hashtags
- Stay under 60 characters

Just return the best title. No explanation.
`;

  const response = await queryGemini(prompt);

  return (response || 'Untitled').trim();
}