export interface PostWindow {
  start: Date;
}

const DEFAULT_WINDOWS_UTC = ['15:00', '19:00', '23:00'];

export function getPostingWindows(date = new Date(), windows: string[] = DEFAULT_WINDOWS_UTC): Date[] {
  return windows.map((time) => {
    const [h, m] = time.split(':').map((n) => parseInt(n, 10));
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h, m, 0, 0));
  });
}

export interface FlopAnalysis {
  needsTweak: boolean;
  reason?: string;
}

export function analyzePerformance(views: number[], current: { views: number; likeRate: number }, threshold = 0.5): FlopAnalysis {
  const last20 = views.slice(-20);
  const median = last20.sort((a, b) => a - b)[Math.floor(last20.length / 2)] || 0;
  const isFlop = current.views < median && current.likeRate < threshold;
  return {
    needsTweak: isFlop,
    reason: isFlop ? 'below median performance' : undefined,
  };
}
