# Running it in a browser

The fastest way to see the app working. Expo builds the same React Native
codebase for web via `react-native-web`, so this is the real app — the same
screens, components and API client you get on a phone — rendered in Chrome.

Nothing here is a separate web mock-up. There is one UI.

## Setup

Requires Node 20+, pnpm, and Postgres (Docker, or a local install).

```bash
pnpm install
pnpm db:up                       # Postgres on :5432 via Docker
```

If you already run Postgres locally, skip `db:up` and point `DATABASE_URL` at
it instead.

```bash
cd apps/api
cp .env.example .env
```

Fill in the two secrets — the placeholders are rejected at boot:

```bash
openssl rand -base64 48          # -> JWT_SECRET
openssl rand -base64 32          # -> ENCRYPTION_KEY
```

Then create the schema and load demo data:

```bash
pnpm db:deploy                   # applies the committed migration
pnpm db:seed                     # demo household, ~6 months of transactions
cd ../..
```

## Run

Two terminals:

```bash
pnpm api                         # http://localhost:3000
```

```bash
pnpm web                         # http://localhost:8081
```

Open **http://localhost:8081** and sign in:

```
email:    demo@household.local
password: demo-household-2024
```

The default `EXPO_PUBLIC_API_URL` already points at `localhost:3000`, so no
`.env` is needed in `apps/mobile` for the browser.

## What to look at

The seed generates a plausible Swedish household — salary on the 25th, rent on
the 1st, an ICA run most weeks, subscriptions on fixed days.

- **Översikt** — spend by category as a donut, daily burn rate, projected
  month-end total, six-month trend. Note income reads 0 kr before the 25th:
  the salary genuinely has not arrived yet.
- **Transaktioner** — merchant names resolved from raw bank text
  (`ICA KVANTUM VASASTAN` → ICA). Click a row to recategorise; "apply to
  similar" writes a rule and updates the others.
- **Budget** — the pace marker on each bar is today's position in the month.
  Rent shows "Ligger före takten" because it is fully spent on the 1st.
- **Sparmål** — required monthly contribution to hit a date, or a projected
  completion date at the current rate.
- **Konton** — recurring-charge detection, and CSV/Excel import.

## Resetting

```bash
pnpm db:reset                    # drops, re-migrates and re-seeds
```

## Limits of the web build

Worth knowing before you judge anything as broken:

- **Connecting a bank does not complete on web.** The consent flow hands
  control back to the app through the `householdeconomy://` deep link, which a
  browser cannot open. Everything up to the consent page works; the return trip
  is native-only. CSV import is the way to get data in here.
- **Tokens live in localStorage, not the Keychain.** There is no secure
  storage in a browser. Anything that can run JavaScript on the page can read
  the session, so an XSS bug becomes full account access. Fine for a localhost
  proof of concept; before exposing this build to anyone else, tokens should
  move to an httpOnly cookie set by the API. See `src/api/tokenStore.ts`.
- **Layout is tuned for a phone.** It works in a desktop window but the
  spacing is built for a narrow viewport. Narrow the window, or use Chrome's
  device toolbar, for a fair impression.
