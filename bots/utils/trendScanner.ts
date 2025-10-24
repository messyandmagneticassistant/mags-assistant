export interface TrendScannerOptions {
  tags?: string[];
  type?: string;
}

export async function fetchTrends(_options: TrendScannerOptions = {}): Promise<string[]> {
  return [];
}
