export type BlueprintKind =
  | 'blueprint_full'
  | 'personalization_only'
  | 'scheduler_only';

export interface OrderContext {
  email: string;
  productId: string;
  cohort?: string;
  answers: Record<string, any>;
}

export const BlueprintSchema: Record<BlueprintKind, string[]> = {
  blueprint_full: ['name', 'email', 'birthdate', 'intent'],
  personalization_only: ['name', 'email', 'intent'],
  scheduler_only: ['email', 'schedule'],
};
