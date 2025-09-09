# Tally Flow

This document outlines how Tally forms integrate with the worker.

## Forms

Form IDs are supplied via environment variables:

- `TALLY_API_KEY`
- `TALLY_SIGNING_SECRET`
- Optional product specific form IDs via `blueprint:tally` config in KV.

## Expected Fields

Each form is expected to capture at least an `email` field. Additional fields are mapped into the `answers` object.

## Webhooks

Tally webhooks should be configured to POST to `/webhooks/tally`. The worker verifies the signature (if `TALLY_SIGNING_SECRET` is set) and stores the submission in KV under `order:<hash>`.

The webhook body is parsed with `parseSubmission` into an `OrderContext` containing
`email`, optional `productId` and `cohort`, and a free-form `answers` map. The
context is persisted to KV at `thread-state:tally:{id}` and then forwarded to
`/orders/fulfill` for downstream processing.

## Signing Verification

The worker checks the `tally-signature` header. It computes an HMAC SHA-256 over `<timestamp>.<body>` using `TALLY_SIGNING_SECRET` and compares to the `v1` signature. If the secret is absent, the webhook still accepts but logs a warning.
