export interface MaggieTrend {
  title: string;
  url?: string;
  score?: number;
  [key: string]: unknown;
}

export interface MaggieState {
  currentTasks?: string[];
  lastCheck?: string;
  scheduledPosts?: string[];
  flopRetries?: string[];
  topTrends?: MaggieTrend[];
  website?: string;
  [key: string]: unknown;
}

export const THREAD_STATE_KEY = 'thread-state';
