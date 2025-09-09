export type Cohort = 'child' | 'teen' | 'adult' | 'elder';

export type FunnelKind =
  | 'blueprint_full'
  | 'personalization_only'
  | 'scheduler_only';

export interface OrderContext {
  email: string;
  productId: string;
  cohort?: Cohort;
  answers?: Record<string, any>;
  createdAt: string;
  source: 'tally';
}

interface SubmissionBody {
  data?: { [key: string]: any };
  formId?: string;
  [key: string]: any;
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

export function parseSubmission(formId: string, body: SubmissionBody): OrderContext {
  const data = body.data || body;
  const answers: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) answers[k] = v;
  }

  const email = isString(data.email) ? data.email : '';
  const productId = isString(data.productId) ? data.productId : formId;
  const cohort =
    isString(data.cohort) && ['child', 'teen', 'adult', 'elder'].includes(data.cohort)
      ? (data.cohort as Cohort)
      : undefined;

  return {
    email,
    productId,
    cohort,
    answers,
    createdAt: new Date().toISOString(),
    source: 'tally',
  };
}
