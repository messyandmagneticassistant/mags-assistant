import { CaptionOptions } from '../types';
import { queryGemini } from '../utils/gemini'; // adjust path if needed

export async function generateHashtags(options: CaptionOptions): Promise<string[]> {
  const { persona = 'main', videoTheme = 'general', overlayText = '', trendingAudio = '' } = options;

  const prompt = `
You are a TikTok strategist for the account "${persona}". Based on the following inputs, generate 5–7 highly relevant, viral-optimized hashtags (no # symbols):

• Video Theme: ${videoTheme}
• Overlay Text: ${overlayText}
• Trending Audio: ${trendingAudio}

Return ONLY the raw list of hashtags (no symbols or extra text), in descending order of importance. Prioritize reach + authenticity.
`;

  const response = await queryGemini(prompt);

  if (!response) return [];

  return response
    .split('\n')
    .map((line) => line.trim().replace(/^[-•#]+/, ''))
    .filter(Boolean);
}