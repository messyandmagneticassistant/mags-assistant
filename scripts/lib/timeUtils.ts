const QUIET_TIMEZONE = 'America/Denver';
const QUIET_START_HOUR = 22;
const QUIET_DURATION_HOURS = 9;

interface DenverParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: QUIET_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export interface QuietWindow {
  start: Date;
  end: Date;
  timeZone: string;
}

function extractParts(date: Date): DenverParts {
  const parts = partsFormatter.formatToParts(date);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  const value = (key: string, fallback: number) => {
    const raw = lookup.get(key);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    year: value('year', date.getUTCFullYear()),
    month: value('month', date.getUTCMonth() + 1),
    day: value('day', date.getUTCDate()),
    hour: value('hour', date.getUTCHours()),
    minute: value('minute', date.getUTCMinutes()),
    second: value('second', date.getUTCSeconds()),
  };
}

function denverDateToUtc(parts: DenverParts, hour: number, minute = 0, second = 0): Date {
  const base = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, second);
  const asDenver = new Date(new Date(base).toLocaleString('en-US', { timeZone: QUIET_TIMEZONE }));
  const offset = base - asDenver.getTime();
  return new Date(base + offset);
}

export function computeQuietWindow(reference: Date = new Date()): QuietWindow {
  const referenceParts = extractParts(reference);
  const usePreviousDay = referenceParts.hour < QUIET_START_HOUR;
  const baseRef = usePreviousDay ? new Date(reference.getTime() - 24 * 60 * 60 * 1000) : reference;
  const baseParts = extractParts(baseRef);
  const start = denverDateToUtc(baseParts, QUIET_START_HOUR, 0, 0);
  const end = new Date(start.getTime() + QUIET_DURATION_HOURS * 60 * 60 * 1000);
  return { start, end, timeZone: QUIET_TIMEZONE };
}

export function isWithinQuietHours(date: Date): boolean {
  const window = computeQuietWindow(date);
  return date >= window.start && date < window.end;
}

export function formatInTimeZone(
  date: Date,
  timeZone: string = QUIET_TIMEZONE,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    ...options,
  });
  return formatter.format(date);
}

export function resolveSince(value: string | undefined | null, now: Date = new Date()): Date {
  if (!value) {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
  if (value === 'lastQuietStart') {
    return computeQuietWindow(now).start;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  return new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

export { QUIET_TIMEZONE, QUIET_START_HOUR, QUIET_DURATION_HOURS };
