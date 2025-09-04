export interface CaptionLine { start: number; end: number; text: string }

export function generateSRT(lines: CaptionLine[]): string {
  return lines
    .map((l, i) => `${i + 1}\n${fmt(l.start)} --> ${fmt(l.end)}\n${l.text}\n`)
    .join('\n');
}

export function burnInCaptions(_file: string, _lines: CaptionLine[], font = process.env.BRAND_FONT || 'Inter') {
  // TODO: use ffmpeg to burn captions
  console.log(`[captions] burn-in using font ${font}`);
}

function fmt(ms: number) {
  const date = new Date(ms);
  return date.toISOString().substring(11, 23).replace('.', ',');
}
