export interface MaggieTrend {
  title: string;
  url?: string;
  score?: number;
  [key: string]: unknown;
}

export interface AutonomyRunIssue {
  key: string;
  label?: string;
  detail?: string;
  state?: string;
  critical?: boolean;
}

export interface AutonomyRunLogEntry {
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  summary?: string;
  ok?: boolean;
  critical?: boolean;
  nextRun?: string | null;
  actions?: string[];
  errors?: AutonomyRunIssue[];
  warnings?: AutonomyRunIssue[];
  checks?: unknown[];
  quiet?: {
    start: string;
    end: string;
    inQuiet?: boolean;
    timeZone?: string;
  };
}

export interface AutonomyMetadata {
  lastRunAt?: string;
  lastStartedAt?: string;
  lastNextRun?: string | null;
  lastSummary?: string;
  lastDurationMs?: number;
  lastCritical?: boolean;
  fallbackQueued?: string[];
  checks?: string[];
  history?: AutonomyRunLogEntry[];
  lastActions?: string[];
  lastErrors?: AutonomyRunIssue[];
  lastWarnings?: AutonomyRunIssue[];
  lastQuietWindow?: AutonomyRunLogEntry['quiet'];
}

export interface MaggieState {
  currentTasks?: string[];
  lastCheck?: string;
  scheduledPosts?: string[];
  flopRetries?: string[];
  topTrends?: MaggieTrend[];
  website?: string;
  autonomy?: AutonomyMetadata;
  [key: string]: unknown;
}

export const THREAD_STATE_KEY = 'thread-state';
