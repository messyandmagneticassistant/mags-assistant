import { pick } from './pick';
import { getTrendData } from '../services/trends';
import { overlays } from '../shared/overlays'; // Fallback overlays
import { getConfig } from './config';
import { CodexPrompt, runCodex } from '../codex'; // Codex-powered thinking

export async function generateOverlay(themeHint?: string): Promise<{
  overlayText: string;
  overlayStyle: string;
}> {
  const trend = await getTrendData();
  const config = await getConfig('brand');

  let overlayText: string | undefined;
  let overlayStyle: string | undefined;

  // 🧠 Try Codex-generated overlay first
  if (config.brain) {
    const prompt: CodexPrompt = {
      system: `You are a creative overlay generator for TikTok. Your job is to write one short, hook-based on-screen text for a video with a theme like "${themeHint ?? trend?.theme}".`,
      examples: [
        { input: "farmhouse bedtime chaos", output: "every evening at 6:37pm... he shows up at the door" },
        { input: "toddler tantrum magic", output: "POV: he said the spoon was 'too shiny' so now it’s war" },
      ],
      input: themeHint ?? trend?.theme ?? 'mystical family moment',
    };

    const ai = await runCodex(prompt);
    if (ai?.text) overlayText = ai.text;
  }

  // 🛟 Fallback to defaults if AI failed
  if (!overlayText) {
    const fallback = pick(overlays);
    overlayText = fallback?.text ?? '✨ Your magic is showing';
    overlayStyle = fallback?.style ?? 'pastel';
  }

  return {
    overlayText,
    overlayStyle: overlayStyle ?? 'auto',
  };
}