import { ChatModel } from './llm-router'; // decides between GPT, Gemini, Claude, etc.
import { sanitizeText } from './text-utils';
import type { GenerateReplyOptions } from '../types';

export async function generateReply(opts: GenerateReplyOptions): Promise<string | null> {
  const { comment, persona = 'main', context = '' } = opts;
  const cleanComment = sanitizeText(comment);

  const prompt = `
You're an assistant replying to TikTok comments in a style that matches the bot's persona.

Comment: "${cleanComment}"
Context (optional): ${context || '[none]'}
Persona: ${persona}

Reply in a natural, human way — no robotic tone, no markdown, no emojis unless necessary. Avoid sounding fake. Keep it short, real, and tone-matching. Think like a real human would.
`;

  const model = new ChatModel({ engine: 'gpt-4o', temperature: 0.75 });

  try {
    const response = await model.chat(prompt);
    return response?.trim() || null;
  } catch (err) {
    console.error('[generateReply] error:', err);
    return null;
  }
}