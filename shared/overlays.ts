// shared/overlays.ts

export const overlays = [
  "POV: your soul finally makes sense",
  "Your rhythm isn’t broken — it’s sacred.",
  "Not a meltdown. A message.",
  "The moment your chart calls you out ✨",
  "You’re not lazy. You’re misaligned.",
  "Your child’s chart explains *everything*",
  "Ritual > routine",
  "You weren’t meant to blend in",
  "When your life starts to flow again 💫",
  "Soul-aligned, not productivity-obsessed",
  "Healing isn’t linear — it’s rhythmic.",
  "Your sacred weirdness is on purpose.",
  "Time to unlearn the grind.",
  "This isn’t chaos — it’s transition.",
  "Messy, magnetic, and finally aligned.",
];

export function getOverlay(): string {
  const idx = Math.floor(Math.random() * overlays.length);
  return overlays[idx];
}