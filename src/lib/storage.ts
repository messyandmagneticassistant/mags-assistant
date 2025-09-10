export async function download(asset: any): Promise<string> {
  if (typeof asset === 'string') return asset;
  if (asset && typeof asset.file === 'string') return asset.file;
  return String(asset || '');
}
