export async function classifyFrame(_buf: Buffer) {
  // TODO: integrate nsfwjs/opencv
  return { safe: true };
}

export async function redactRegions(_file: string, _regions: any[]) {
  // TODO: apply blur/crop/overlay
  return;
}
