import type { Env } from './lib/env';
import { loadState } from './lib/state';

export interface OpenProjectSummary {
  name: string;
  startedAt?: string;
  stepsCompleted: number;
  totalSteps: number;
  currentStep?: string;
  percentComplete: number;
  id?: string;
}

export type MilestoneKey = 'website' | 'tally' | 'stripe' | 'social';

type ProgressEventMap = {
  'project-update': {
    env: Env;
    project: OpenProjectSummary;
    previous?: OpenProjectSummary;
  };
  'step-advanced': {
    env: Env;
    project: OpenProjectSummary;
    previous: OpenProjectSummary;
  };
  'milestone-complete': {
    env: Env;
    project: OpenProjectSummary;
    previous?: OpenProjectSummary;
    milestone: MilestoneKey;
  };
};

type Listener<T> = (payload: T) => void | Promise<void>;

class ProgressEventEmitter {
  private listeners = new Map<keyof ProgressEventMap, Set<Listener<any>>>();

  on<K extends keyof ProgressEventMap>(event: K, listener: Listener<ProgressEventMap[K]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as Listener<any>);
  }

  off<K extends keyof ProgressEventMap>(event: K, listener: Listener<ProgressEventMap[K]>): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    bucket.delete(listener as Listener<any>);
    if (!bucket.size) {
      this.listeners.delete(event);
    }
  }

  emit<K extends keyof ProgressEventMap>(event: K, payload: ProgressEventMap[K]): void {
    const bucket = this.listeners.get(event);
    if (!bucket || !bucket.size) return;
    for (const listener of bucket) {
      try {
        const result = listener(payload);
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).catch((err) => console.warn('[progress] listener failed', err));
        }
      } catch (err) {
        console.warn('[progress] listener threw', err);
      }
    }
  }
}

export const progressEvents = new ProgressEventEmitter();

type RawProject = Record<string, unknown>;

type MaybeProjects = RawProject[] | Record<string, RawProject> | undefined;

function toArray(value: unknown): RawProject[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => (entry && typeof entry === 'object' ? (entry as RawProject) : undefined))
      .filter((entry): entry is RawProject => Boolean(entry));
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((entry) => (entry && typeof entry === 'object' ? (entry as RawProject) : undefined))
      .filter((entry): entry is RawProject => Boolean(entry));
  }
  return [];
}

function coerceISO(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed;
  return date.toISOString();
}

function coerceName(project: RawProject): string | undefined {
  const fields = ['name', 'title', 'label'];
  for (const key of fields) {
    const raw = project[key];
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

function coerceId(project: RawProject): string | undefined {
  const fields = ['id', 'slug', 'key', 'identifier'];
  for (const key of fields) {
    const raw = project[key];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
  }
  return undefined;
}

function coerceStepLabel(step: Record<string, unknown>): string | undefined {
  const candidates = ['label', 'title', 'name', 'step', 'description'];
  for (const key of candidates) {
    const raw = step[key];
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

function normalizeSteps(project: RawProject): RawProject[] {
  const candidates: unknown[] = [];
  if (Array.isArray(project.steps)) candidates.push(project.steps);
  if (Array.isArray(project.history)) candidates.push(project.history);
  if (Array.isArray(project.log)) candidates.push(project.log);
  if (Array.isArray(project.entries)) candidates.push(project.entries);
  if (!candidates.length && project.lastStep && typeof project.lastStep === 'object') {
    candidates.push([project.lastStep]);
  }
  if (!candidates.length) return [];
  return candidates
    .flat()
    .map((entry) => (entry && typeof entry === 'object' ? (entry as RawProject) : undefined))
    .filter((entry): entry is RawProject => Boolean(entry));
}

function isStepCompleted(step: RawProject): boolean {
  if (typeof step.done === 'boolean') return step.done;
  if (typeof step.completed === 'boolean') return step.completed;
  if (typeof step.finished === 'boolean') return step.finished;
  if (typeof step.completedAt === 'string' && step.completedAt.trim()) return true;
  if (typeof step.finishedAt === 'string' && step.finishedAt.trim()) return true;
  if (typeof step.status === 'string') {
    const lowered = step.status.toLowerCase();
    if (['done', 'complete', 'completed', 'finished', 'success'].includes(lowered)) return true;
  }
  if (typeof step.state === 'string') {
    const lowered = step.state.toLowerCase();
    if (['done', 'complete', 'completed', 'finished', 'success'].includes(lowered)) return true;
  }
  return false;
}

function projectLooksClosed(project: RawProject): boolean {
  if (typeof project.open === 'boolean' && !project.open) return true;
  if (typeof project.active === 'boolean' && !project.active) return true;
  if (typeof project.closed === 'boolean' && project.closed) return true;
  if (typeof project.completed === 'boolean' && project.completed) return true;
  if (typeof project.finished === 'boolean' && project.finished) return true;
  const statusField = ['status', 'state', 'phase']
    .map((key) => {
      const raw = project[key];
      return typeof raw === 'string' ? raw.toLowerCase() : undefined;
    })
    .find(Boolean);
  if (statusField) {
    const closedTerms = ['done', 'complete', 'completed', 'finished', 'closed', 'archived', 'cancelled'];
    if (closedTerms.some((term) => statusField.includes(term))) return true;
  }
  const closedAtFields = ['closedAt', 'finishedAt', 'completedAt'];
  for (const key of closedAtFields) {
    if (typeof project[key] === 'string' && project[key]!.toString().trim()) {
      return true;
    }
  }
  return false;
}

function normalizeProject(project: RawProject): OpenProjectSummary | undefined {
  if (projectLooksClosed(project)) return undefined;
  const name = coerceName(project) ?? 'Unnamed project';
  const startedAt = coerceISO(project.startedAt ?? project.createdAt ?? project.openedAt);
  const steps = normalizeSteps(project);
  const explicitCount = typeof project.stepsCompleted === 'number' ? project.stepsCompleted : undefined;
  const explicitTotal =
    typeof project.totalSteps === 'number'
      ? project.totalSteps
      : typeof project.stepsTotal === 'number'
      ? project.stepsTotal
      : typeof project.total === 'number'
      ? project.total
      : undefined;
  let stepsCompleted = explicitCount ?? 0;
  let totalSteps = typeof explicitTotal === 'number' && Number.isFinite(explicitTotal) ? explicitTotal : 0;
  let currentStep: string | undefined = typeof project.currentStep === 'string' ? project.currentStep.trim() || undefined : undefined;
  let percentComplete =
    typeof project.percentComplete === 'number'
      ? project.percentComplete
      : typeof project.percent === 'number'
      ? project.percent
      : typeof project.progress === 'number'
      ? project.progress
      : 0;
  if (steps.length) {
    let counted = 0;
    let lastLabel: string | undefined;
    for (const step of steps) {
      const label = coerceStepLabel(step);
      if (label) lastLabel = label;
      if (isStepCompleted(step)) counted += 1;
    }
    if (!stepsCompleted) {
      stepsCompleted = counted || steps.length;
    }
    if (!totalSteps) {
      totalSteps = steps.length;
    }
    if (!currentStep) {
      currentStep = lastLabel;
    }
  }
  if (!totalSteps) {
    totalSteps = typeof project.steps === 'number' ? project.steps : 0;
  }
  if (!stepsCompleted) stepsCompleted = 0;
  if (totalSteps && stepsCompleted > totalSteps) {
    totalSteps = stepsCompleted;
  }
  if (!Number.isFinite(percentComplete) || percentComplete < 0) {
    percentComplete = 0;
  }
  if (percentComplete > 100) {
    percentComplete = 100;
  }
  if (!percentComplete && totalSteps > 0) {
    percentComplete = Math.min(100, Math.round((stepsCompleted / totalSteps) * 100));
  }
  return {
    name,
    startedAt,
    stepsCompleted,
    totalSteps,
    currentStep,
    percentComplete,
    id: coerceId(project),
  };
}

function collectProjects(progress: MaybeProjects): RawProject[] {
  if (!progress) return [];
  if (Array.isArray(progress)) return toArray(progress);
  if (typeof progress === 'object') {
    return toArray(progress);
  }
  return [];
}

const SNAPSHOTS = new WeakMap<Env, Map<string, OpenProjectSummary>>();

function snapshotKey(project: OpenProjectSummary): string {
  return `${project.id ?? project.name}|${project.startedAt ?? ''}`;
}

function detectMilestone(project: OpenProjectSummary): MilestoneKey | undefined {
  const text = `${project.name} ${project.currentStep ?? ''}`.toLowerCase();
  if (text.includes('stripe')) return 'stripe';
  if (text.includes('tally')) return 'tally';
  if (text.includes('website') || text.includes('site build') || text.includes('web build')) return 'website';
  if (text.includes('social') || text.includes('content batch') || text.includes('social push')) return 'social';
  return undefined;
}

function trackProgress(env: Env, projects: OpenProjectSummary[]): void {
  const previous = SNAPSHOTS.get(env);
  const nextSnapshot = new Map<string, OpenProjectSummary>();
  for (const project of projects) {
    nextSnapshot.set(snapshotKey(project), project);
  }
  if (!previous) {
    SNAPSHOTS.set(env, nextSnapshot);
    return;
  }
  for (const [key, project] of nextSnapshot) {
    const prev = previous.get(key);
    if (!prev) continue;
    if (project.stepsCompleted !== prev.stepsCompleted || project.percentComplete !== prev.percentComplete) {
      progressEvents.emit('project-update', { env, project, previous: prev });
      if (project.stepsCompleted > prev.stepsCompleted) {
        progressEvents.emit('step-advanced', { env, project, previous: prev });
      }
      const milestone = detectMilestone(project);
      if (milestone) {
        const completed = prev.percentComplete < 100 && project.percentComplete >= 100;
        const advanced = project.stepsCompleted > prev.stepsCompleted;
        if (completed || (milestone === 'social' && advanced)) {
          progressEvents.emit('milestone-complete', { env, project, previous: prev, milestone });
        }
      }
    }
  }
  SNAPSHOTS.set(env, nextSnapshot);
}

export async function getOpenProjects(env: Env): Promise<OpenProjectSummary[]> {
  const state = await loadState(env);
  const container = (state as any)?.progress;
  const candidates: RawProject[] = [];
  const pools: MaybeProjects[] = [
    Array.isArray(container) ? container : undefined,
    container?.projects as MaybeProjects,
    container?.active as MaybeProjects,
    container?.open as MaybeProjects,
    container?.pipelines as MaybeProjects,
    container?.items as MaybeProjects,
    container?.list as MaybeProjects,
    container as MaybeProjects,
  ];
  for (const pool of pools) {
    for (const project of collectProjects(pool)) {
      candidates.push(project);
    }
  }
  const seen = new Set<string>();
  const normalized: OpenProjectSummary[] = [];
  for (const project of candidates) {
    const info = normalizeProject(project);
    if (!info) continue;
    const key = `${info.name}|${info.startedAt ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(info);
  }
  normalized.sort((a, b) => {
    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return aTime - bTime;
  });
  trackProgress(env, normalized);
  return normalized;
}
