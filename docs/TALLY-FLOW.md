# Tally Forms Flow

This document enumerates the current Tally forms used in the Soul Blueprint funnel.

## Forms
- **blueprint_full** – collects name, email, birthdate, intent and scheduling info.
- **personalization_only** – collects name, email, intent.
- **scheduler_only** – collects email and desired schedule.

All forms send webhooks to `/webhooks/tally` with the raw submission payload.

## Webhooks
Each submission is mapped to an `OrderContext`:
```ts
{
  email: string;
  productId: string;
  cohort?: string;
  answers: Record<string, any>;
}
```
The `answers` object contains the full Tally payload for later processing.
