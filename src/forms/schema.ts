export type Cohort = 'child' | 'teen' | 'adult' | 'elder';

export interface OrderContext {
  email: string;
  productId?: string;
  cohort?: Cohort;
  answers: Record<string, unknown>;
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
  const answers: Record<string, unknown> = {};
  const data = body.data || body;
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) answers[k] = v;
  }
  const email = isString(data.email) ? data.email : '';
  const productId = isString(data.productId) ? data.productId : undefined;
  const cohort = isString(data.cohort) && ['child', 'teen', 'adult', 'elder'].includes(data.cohort) ? (data.cohort as Cohort) : undefined;

  return { email, productId, cohort, answers };
}

export const blueprint_full = ['email', 'productId', 'cohort'];
export const personalization_only = ['email'];
export const scheduler_only = ['email'];
