export const POLICY = {
  // nsfwjs scores (0..1)
  nsfw: { porn: 0.20, hentai: 0.20, sexy: 0.38, neutralFloor: 0.05 },
  // if skin-pixel ratio heuristic exceeds this, auto-crop/blur
  skinRatioAutoFix: 0.28,
  // duration / format
  maxSeconds: 59,
  targetFPS: 30,
  // audio
  normalizeLUFS: -14, // target loudness
  // captions
  profanityBlock: true,
};

export type SafetyStatus = "approved" | "fixed" | "rejected";
