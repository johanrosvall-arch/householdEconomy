# Connecting Swedish banks

## The constraint that shapes everything

You cannot integrate directly with Handelsbanken, Länsförsäkringar, Swedbank,
SEB or Nordea. Reading someone else's account data in the EU is a regulated
activity under PSD2: you need an **AISP** (Account Information Service
Provider) licence from Finansinspektionen, with the capital requirements,
compliance function and PSD2 insurance that go with it.

The realistic path for an app like this is to use a **licensed aggregator**.
They hold the licence, maintain the connections to each bank, and expose one
API. You are either their customer or their registered agent.

This repo therefore ships a **provider abstraction**
(`apps/api/src/services/banking/provider.ts`) with a mock adapter. Swapping in
a real provider is implementing one interface — no other part of the app
changes.

## Choosing a provider

| Provider | Swedish coverage | Cost to start | Notes |
| --- | --- | --- | --- |
| **GoCardless Bank Account Data** (ex-Nordigen) | Strong. Handelsbanken, Länsförsäkringar, Swedbank, SEB, Nordea, ICA Banken, Danske | Free tier | Best starting point. Raw transactions, no enrichment. Rate-limited to ~4 unattended calls per account per day |
| **Tink** (Visa) | Best in market — it is a Swedish company | Commercial contract | Adds merchant enrichment and its own categorisation. Overkill until you have users |
| **Enable Banking** | Good Nordic coverage | Free sandbox | Smaller ecosystem, thinner docs |

### Cards and BNPL are a separate problem

Amex and Klarna are *not* reliably reachable through PSD2 aggregators in
Sweden:

- **American Express** exposes some European card accounts under PSD2, but SE
  coverage through aggregators is patchy and inconsistent.
- **Klarna** runs its own open-banking arm (Klarna Kosma) — which aggregates
  *other* banks. Getting a user's own Klarna balance and instalment plans in is
  a different, direct integration.

For both, **CSV/Excel import is the reliable route today**, which is why the
file importer is a first-class feature rather than a fallback. See
[csv-formats.md](./csv-formats.md).

## Implementing a real adapter

Implement `BankProvider` and register it in
`apps/api/src/services/banking/index.ts`:

```ts
registerProvider('gocardless', () => new GoCardlessProvider(env));
```

Then set `BANK_PROVIDER=gocardless` in the environment. Nothing else changes —
routes, sync loop, and the mobile app all talk to the interface.

The mock adapter is deliberately shaped like the GoCardless flow, so the four
methods map one-to-one onto its endpoints:

| Interface method | GoCardless endpoint |
| --- | --- |
| `listInstitutions(country)` | `GET /api/v2/institutions/?country=se` |
| `createLink(params)` | `POST /api/v2/agreements/enduser/` then `POST /api/v2/requisitions/` |
| `getLinkState(ref)` | `GET /api/v2/requisitions/{id}/` |
| `fetchAccounts(ref)` | `GET /api/v2/accounts/{id}/` per account in the requisition |
| `fetchTransactions(ref, acct)` | `GET /api/v2/accounts/{id}/transactions/` |

### Things the interface already accounts for

- **Access tokens are short-lived.** GoCardless issues a 24h access token and a
  30-day refresh token from `POST /api/v2/token/new/`. Store them encrypted —
  `Connection.secretCiphertext` exists for exactly this, and
  `lib/crypto.ts` provides AES-256-GCM envelope encryption.
- **Consent expires every 90 days.** PSD2 requires the user to re-authenticate.
  `consentExpiresAt` is on the connection, `findConnectionsNeedingAttention()`
  surfaces the ones about to lapse, and the overview screen shows the warning.
  Throw `ProviderError(msg, 'consent_expired')` and the sync layer marks the
  connection `expired` rather than `error`.
- **Rate limits are per account per day.** The household-wide sync endpoint
  runs connections sequentially for this reason. Do not parallelise it.
- **Amounts arrive as decimal strings.** `"transactionAmount": {"amount":
  "-459.00", "currency": "SEK"}`. Use `parseAmount()` from
  `@household/shared` — it converts to integer minor units without floating
  point, which `Number(x) * 100` does not do correctly (see the `1.005` case in
  the money tests).
- **Booked vs pending.** GoCardless returns `booked` and `pending` arrays.
  Map pending to `pending: true`; the ledger re-fetches them until they settle,
  and dedupe handles the transition.
- **Banks retroactively adjust bookings.** The sync overlaps the last 10 days
  on every incremental pull. A shorter window silently misses corrections.

### Sandbox testing

GoCardless publishes `SANDBOXFINANCE_SFIN0000`, which completes the consent
flow without a real bank. Point `BANK_PROVIDER` at your adapter and use that
institution id end-to-end before touching a live bank.

## What the user sees, and what they should be told

The consent flow hands the user to their own bank, where they authenticate with
BankID. Your app never sees their credentials. Worth stating plainly in the UI —
the settings screen does this — because "connect your bank" reasonably makes
people nervous.

Two obligations worth building in from the start, not retrofitting:

- **Data minimisation.** Only request the accounts and history you need. The
  default here is 365 days on first link.
- **Revocation.** Disconnecting must revoke at the provider, not just locally.
  `deleteLink()` covers this. Note that the app deliberately *keeps* the
  imported transaction history when a connection is removed — it is the user's
  own financial record, and deleting it would silently rewrite past months.
  Deleting the data is a separate, explicit action.
