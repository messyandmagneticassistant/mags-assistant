// caption-generator.ts

const fallbackCaptions = [
  "POV: You needed this today 🧠✨",
  "Loop this if it hit you too.",
  "Don't scroll. Let it sink in.",
  "This wasn’t random. Watch again.",
  "One of those posts you save but never forget.",
  "For the ones who feel too much.",
  "You’re not alone in this.",
  "Maybe your soul needed this one.",
  "For the overthinkers and dreamers.",
  "Let it hit your heart, not just your screen.",
];

export async function getCaptionSuggestions(username: string): Promise<string> {
  try {
    // Placeholder: in future we can fetch trending data or rotate based on time of day
    const randomIndex = Math.floor(Math.random() * fallbackCaptions.length);
    const baseCaption = fallbackCaptions[randomIndex];

    return `${baseCaption} // @${username}`;
  } catch (err) {
    console.error('[caption-generator] fallback triggered:', err);
    return `Save this one // @${username}`;
  }
}