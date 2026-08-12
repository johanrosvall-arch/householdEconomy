# Architecture

```
apps/mobile      Expo / React Native app (iOS + Android)
apps/api         Fastify + Prisma + Postgres
packages/shared  Types, money and date maths, category taxonomy
```

TypeScript throughout, so the wire types are defined once in
`packages/shared/src/types.ts` and a field rename breaks the build on both
sides at the same time.

## Why there is a backend

An on-device-only app would be simpler and more private, but it rules out the
two things this app is for:

- **Bank aggregation.** Provider credentials cannot ship inside a mobile
  binary, and OAuth/consent callbacks need a server.
- **A shared household.** Two people looking at the same budget means shared
  state.

## Money

Every amount is an **integer in minor units** (öre). Never a float — a ledger
that accumulates IEEE-754 error is worthless.

Sign convention matches a bank statement: **negative is money out**. Spending
is flipped to positive exactly once, at the boundary where it is presented
("you spent 4 200 kr of 5 000 kr"), and stays positive through the DTO into
the UI.

## What counts as spending

The core question — "where did our cash go?" — is only answerable if the totals
exclude money that never left the household:

- Categories have a `kind`: `expense`, `income`, or `transfer`.
- Only `expense` counts as spend. Only `income` counts as income.
- `transfer` categories (between own accounts, into savings, credit-card
  settlement) count as neither.
- Refunds **net against their own category** rather than counting as income.
  Returning a jacket gives back clothing budget; it is not a payday. A category
  whose refunds exceed its purchases floors at zero rather than going negative.

Internal transfers are also detected structurally: `services/transfers.ts`
pairs equal-and-opposite legs across two different accounts booked within a few
days, and marks both. Without this, one 5 000 kr transfer reads as 5 000 kr of
spending *and* 5 000 kr of income.

## Categorisation

Four layers, highest confidence first (`services/categorisation.ts`):

1. **Household rules** — explicit user instructions. Confidence 1.0.
2. **Merchant dictionary** — ~90 built-in Swedish merchant patterns.
3. **Heuristics** — sign, direct-debit markers, structural hints.
4. **Uncategorised** — surfaced in the app for the user to fix.

Two properties worth preserving if you change this:

- **`categoryLocked` is never overwritten.** Once a human sets a category,
  no automatic pass may change it.
- **Patterns and text are both ASCII-folded before matching.** This is not
  cosmetic: JavaScript's `\b` is defined over `[A-Za-z0-9_]`, so
  `/\böverföring\b/` can *never* match — there is no word boundary before `ö`.
  Folding both sides keeps patterns in the range where `\b` works, and makes
  matching accent-insensitive as a side effect. Display names are derived from
  the unfolded text, so users still see "Okänd Butik".

"Apply to similar" turns a one-off correction into a stored rule, so the app
gets more accurate through normal use rather than through rule management.

## The single write path

Everything that adds a transaction goes through `insertTransactions()` in
`services/ledger.ts` — file import, bank sync, and manual entry alike. It owns
deduplication, categorisation, balance recalculation and transfer pairing.

Writing a transaction outside this function will eventually produce a
double-counted month.

Balances are **recomputed from the ledger** rather than adjusted incrementally.
Slower, but an incremental balance drifts the first time an insert half-fails,
and a wrong balance is the one number a user will notice immediately.

## Request scoping

Every financial route resolves its household through
`fastify.requireHousehold(request, householdId, minimumRole)`, which checks
membership and role in one place. Routes must never take a household id from a
request body — that is how one household ends up reading another's ledger.
Missing household and non-member produce the same 403, so the API does not
confirm which household ids exist.

## Data model notes

- Calendar days are stored as `YYYY-MM-DD` strings and budget periods as
  `YYYY-MM`, not `DateTime`. A budget month is not an instant, and storing it
  as one invites timezone drift.
- `Transaction.period` is denormalised from `date` for cheap grouping.
- Categories are copied per household from the shared taxonomy, so a household
  can rename or add to them without affecting anyone else.
- Provider credentials are encrypted at rest (AES-256-GCM, `lib/crypto.ts`).
  A dump of the `connections` table is inert without `ENCRYPTION_KEY`.

## Testing

The domain logic is written as pure functions taking plain data, so the test
suite runs without a database:

- `packages/shared` — amount and date parsing, period maths (33 tests)
- `apps/api` — categorisation, import/format detection, budget, goals,
  transfers, overview (95 tests)

`pnpm test` runs both.
