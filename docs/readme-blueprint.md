# Blueprint Content + Pricing

## Fixtures
Blueprint copy lives in `content/fixtures/blueprint/`:
- `full.md`
- `mini.md`
- `lite.md`
- `realignment.md`
- `subscriptions.daily.md`
- `subscriptions.monthly.md`
- `subscriptions.combo.md`

Adjust copy directly in these markdown files. All tiers share the same headings; Mini and Lite compress wording.

## Loader & Child-Friendly Toggle
Use `getBlueprintSections(tier, { childFriendly })` from `content/loader/blueprint.ts`.
Passing `{ childFriendly: true }` includes the “Child-Friendly Version” section.
Without it, that section is omitted.

## Checks & Tests
Run all tests:

```bash
pnpm test
```

Run only the fixture checks:

```bash
pnpm content:check
```

## Price Proposal
Proposed Stripe price ranges (no automatic changes) are generated via:

```bash
pnpm proposal:prices
```

This writes `.proposals/stripe-price-proposal.json`. Review before updating Stripe.

Remember: Stripe price changes are reviewed and applied manually.
