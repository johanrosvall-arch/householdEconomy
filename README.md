# Hushållsekonomi — household spend tracker

A mobile app for tracking a Swedish household's income and spending close to
real time, categorised, with budgets and savings goals.

```
apps/mobile      Expo / React Native (Android; iOS needs an Apple account)
apps/api         Fastify + Prisma + Postgres
packages/shared  Types, money and date maths, category taxonomy
```

## What works

- **Overview** — income, spend and what's left this month; spend by category as
  a donut; daily burn rate and a projected month-end total; net worth; a
  six-month trend.
- **Transactions** — searchable, infinite-scrolling list. Tap to recategorise;
  "apply to similar" stores a rule so next month sorts itself.
- **Automatic categorisation** — household rules, then a built-in dictionary of
  ~90 Swedish merchants (ICA, Willys, Systembolaget, SL, Circle K, Telia,
  Vattenfall, Försäkringskassan…), then heuristics. A category set by a human
  is never overwritten.
- **Budgets** — a monthly limit per category, pace-aware (spending 90% by the
  15th is flagged), optional envelope rollover, and suggested limits derived
  from the household's own history.
- **Savings goals** — progress from logged contributions or from a dedicated
  account's balance, required monthly contribution to hit a date, and projected
  completion at the current rate.
- **File import** — CSV/Excel from any bank, with format detection for
  Handelsbanken, Länsförsäkringar, Swedbank, SEB, Nordea, ICA Banken, Amex,
  Klarna and Revolut, plus content-based inference for anything else.
- **Bank connections** — full PSD2 consent flow against a provider abstraction.

## What is stubbed

**Bank sync runs against a mock adapter.** Direct integration with
Handelsbanken or Länsförsäkringar is not legally possible without a PSD2 AISP
licence — you go through a licensed aggregator (GoCardless Bank Account Data,
Tink, Enable Banking). The provider interface, consent lifecycle, 90-day
re-authentication, encrypted token storage and incremental sync are all built;
what remains is implementing `BankProvider` against a provider you have signed
up with.

The mock adapter generates a realistic Swedish household's ledger — salary on
the 25th, rent on the 1st, an ICA run most weeks — so every screen is usable
end to end today.

See [docs/bank-integrations.md](docs/bank-integrations.md) for the provider
comparison and an endpoint-by-endpoint mapping for a real adapter.

Also note: **Amex and Klarna are not reliably reachable via PSD2 aggregators in
Sweden.** CSV import is the working route for those, which is why the importer
is a first-class feature.

## Running it

Requires Node 20+, pnpm, and Docker (for Postgres). Expo SDK 57.

```bash
pnpm install

# Postgres on :5432
pnpm db:up

cd apps/api
cp .env.example .env          # then set JWT_SECRET and ENCRYPTION_KEY
pnpm db:migrate               # creates the schema
pnpm db:seed                  # demo household with ~6 months of data
cd ../..

pnpm api                      # http://localhost:3000
pnpm mobile                   # Expo — scan the QR code with Expo Go
```

Generate the two secrets with:

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY
```

The seed creates a demo login:

```
email:    demo@household.local
password: demo-household-2024
```

On a physical device `localhost` is the phone itself, so point the app at your
machine: copy `apps/mobile/.env.example` to `.env` and set
`EXPO_PUBLIC_API_URL` to your LAN or Tailscale address. Set `PUBLIC_API_URL` in
`apps/api/.env` to match, so the mock bank's consent page is reachable too.

**Getting it onto an Android phone** — including the EAS build and the
Tailscale setup — is covered step by step in
[docs/running-on-android.md](docs/running-on-android.md).

## Tests

```bash
pnpm test        # 134 tests, no database required
pnpm typecheck
```

The domain logic — amount parsing, date parsing, categorisation, format
detection, budget maths, goal projection, transfer pairing — is written as pure
functions over plain data, so it is tested without a database.

## Design notes worth knowing before changing things

- **Money is integer minor units (öre), never floats.** Negative is money out,
  matching a bank statement.
- **Transfers are not spending.** Moving 5 000 kr to savings would otherwise
  register as 5 000 kr spent *and* 5 000 kr earned. Transfer-kind categories are
  excluded from both totals, and equal-and-opposite legs across accounts are
  paired automatically.
- **Refunds net against their category**, they are not income.
- **One write path.** All transactions enter through `insertTransactions()`,
  which owns dedupe, categorisation, balances and transfer pairing.
- **Balances are recomputed from the ledger**, not adjusted incrementally.

Further detail in [docs/architecture.md](docs/architecture.md) and
[docs/csv-formats.md](docs/csv-formats.md).

## Not built yet

- Multi-user household invitations (the data model supports members and roles;
  there is no invite flow)
- Push notifications for budget overruns
- Shared/split expenses between household members
- Multi-currency conversion (accounts carry a currency; there are no FX rates)
- Background sync scheduling (sync runs on app open and on pull-to-refresh)
