import fs from 'node:fs/promises';
import path from 'node:path';

export interface ConflictResolutionDetail {
  index: number;
  selected: 'ours' | 'theirs';
  oursScore: number;
  theirsScore: number;
  reason: string;
}

export interface ConflictResolutionResult {
  filePath: string;
  hadConflicts: boolean;
  resolved: boolean;
  details: ConflictResolutionDetail[];
}

function hasConflictMarkers(content: string): boolean {
  return content.includes('<<<<<<<') && content.includes('=======') && content.includes('>>>>>>>');
}

const KEYWORD_SCORING: Array<{ pattern: RegExp; weight: number; description: string }> = [
  { pattern: /\/status/g, weight: 4, description: 'status command' },
  { pattern: /\/(repair|fix)\s+telegram/g, weight: 6, description: 'repair telegram command' },
  { pattern: /\/(post|broadcast|announce)/g, weight: 3, description: 'post/broadcast command' },
  { pattern: /handleTelegramMessage/g, weight: 8, description: 'main handler implementation' },
  { pattern: /handleTelegramUpdate/g, weight: 5, description: 'update handler glue' },
  { pattern: /recordInput/g, weight: 3, description: 'recordInput instrumentation' },
  { pattern: /snapshot/g, weight: 2, description: 'scheduler snapshot usage' },
  { pattern: /sendTelegram/g, weight: 2, description: 'sendTelegram helper usage' },
  { pattern: /wakeSchedulers|stopSchedulers|tickScheduler/g, weight: 2, description: 'scheduler controls' },
];

function scoreSegment(segment: string): number {
  let score = 0;
  for (const entry of KEYWORD_SCORING) {
    const matches = segment.match(entry.pattern);
    if (matches) {
      score += matches.length * entry.weight;
    }
  }
  // Penalize unresolved markers
  if (segment.includes('<<<<<<<') || segment.includes('>>>>>>>')) {
    score -= 100;
  }
  // Slight preference for longer (assumed richer) implementations
  score += Math.min(20, Math.floor(segment.trim().split(/\n+/).length / 5));
  return score;
}

interface ParsedConflict {
  start: number;
  end: number;
  ours: string;
  theirs: string;
}

function parseConflicts(content: string): ParsedConflict[] {
  const conflicts: ParsedConflict[] = [];
  const regex = /<<<<<<<[^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>>[^\n]*\n/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content))) {
    const [full, ours, theirs] = match;
    const start = match.index;
    const end = match.index + full.length;
    conflicts.push({ start, end, ours, theirs });
  }
  return conflicts;
}

function applyResolutions(content: string, conflicts: ParsedConflict[]): { output: string; details: ConflictResolutionDetail[] } {
  if (!conflicts.length) {
    return { output: content, details: [] };
  }

  let cursor = 0;
  let output = '';
  const details: ConflictResolutionDetail[] = [];

  for (let index = 0; index < conflicts.length; index++) {
    const conflict = conflicts[index];
    output += content.slice(cursor, conflict.start);

    const oursScore = scoreSegment(conflict.ours);
    const theirsScore = scoreSegment(conflict.theirs);

    let selected: 'ours' | 'theirs';
    let reason: string;

    if (theirsScore > oursScore) {
      selected = 'theirs';
      reason = `Preferred remote changes (${theirsScore} > ${oursScore})`;
    } else if (oursScore > theirsScore) {
      selected = 'ours';
      reason = `Kept local changes (${oursScore} > ${theirsScore})`;
    } else {
      // tie-breaker: prefer the version that mentions repair commands or handleTelegramMessage explicitly
      if (/handleTelegramMessage|\/repair\s+telegram/.test(conflict.theirs) && !/handleTelegramMessage|\/repair\s+telegram/.test(conflict.ours)) {
        selected = 'theirs';
        reason = 'Tie-breaker: theirs keeps repair command/handler';
      } else if (/handleTelegramMessage|\/repair\s+telegram/.test(conflict.ours) && !/handleTelegramMessage|\/repair\s+telegram/.test(conflict.theirs)) {
        selected = 'ours';
        reason = 'Tie-breaker: ours keeps repair command/handler';
      } else {
        selected = 'theirs';
        reason = 'Tie-breaker: default to incoming changes';
      }
    }

    const replacement = selected === 'ours' ? conflict.ours : conflict.theirs;
    output += replacement;
    cursor = conflict.end;

    details.push({ index, selected, oursScore, theirsScore, reason });
  }

  output += content.slice(cursor);
  return { output, details };
}

export async function resolveTelegramConflicts(filePath: string): Promise<ConflictResolutionResult> {
  const absolutePath = path.resolve(filePath);
  const raw = await fs.readFile(absolutePath, 'utf8');

  if (!hasConflictMarkers(raw)) {
    return { filePath: absolutePath, hadConflicts: false, resolved: false, details: [] };
  }

  const conflicts = parseConflicts(raw);
  if (!conflicts.length) {
    return { filePath: absolutePath, hadConflicts: true, resolved: false, details: [] };
  }

  const { output, details } = applyResolutions(raw, conflicts);
  await fs.writeFile(absolutePath, output, 'utf8');

  return { filePath: absolutePath, hadConflicts: true, resolved: true, details };
}

export async function resolveConflictsInRepo(rootDir = process.cwd()): Promise<ConflictResolutionResult[]> {
  try {
    const { spawnSync } = await import('node:child_process');
    const ls = spawnSync('git', ['ls-files', '*telegram.ts'], { cwd: rootDir, encoding: 'utf8' });
    if (ls.status !== 0) {
      throw new Error(ls.stderr?.toString() || 'git ls-files failed');
    }
    const files = ls.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => path.resolve(rootDir, line));

    const results: ConflictResolutionResult[] = [];
    for (const file of files) {
      const resolved = await resolveTelegramConflicts(file);
      results.push(resolved);
    }
    return results;
  } catch (err) {
    console.warn('[telegramConflictResolver] git ls-files failed', err);
    return [];
  }
}
