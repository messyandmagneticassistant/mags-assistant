import { CaptionOptions, CaptionBundle } from '../types';
import { generateOverlay } from './overlay-brain';
import { queryGemini } from '../utils/gemini';

export async function generateFullCaptionBundle(options: CaptionOptions): Promise<CaptionBundle> {
  const { persona = 'main', videoTheme = 'general', tone = 'authentic' } = options;

  const overlay = await generateOverlay(options);

  const prompt = `
You are writing a TikTok caption bundle for the account persona: "${persona}".
The video theme is: ${videoTheme}.
The tone should be: ${tone}.

You will generate:
1. A TikTok main caption (1–2 sentences max, feels real, not overly polished)
2. A list of 5 high-performing hashtags for this topic
3. A first comment (funny, helpful, or in-character)
4. A short one-line summary of the video post for logging

Rules:
- Keep it personal, edgy, or relatable (not generic)
- Captions should never feel AI-written or corporate
- Write like you’re a person with a specific vibe
- Hashtags should mix niche + trending
- Emojis optional, only if authentic to persona

Return your result in **strict JSON** format like this:

{
  "caption": "text",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "firstComment": "text",
  "summary": "one-line summary"
}
`;

  const raw = await queryGemini(prompt);
  try {
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      overlay,
    };
  } catch (err) {
    console.error('[CaptionBrain] JSON parse fail:', err);
    return {
      caption: '',
      hashtags: [],
      firstComment: '',
      summary: '',
      overlay,
    };
  }
}