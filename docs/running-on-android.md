# Running it on your Android phone

Two stages. Stage A gets the app on your phone in about half an hour, with the
laptop tethered. Stage B gives you a real installed app that works over mobile
data. Do A first — it is where you will find the bugs.

Prerequisites: Node 20+, pnpm, Docker, an Android phone.

---

## Stage A — Expo Go, same Wi-Fi

### 1. Start the backend

```bash
pnpm install
pnpm db:up                       # Postgres in Docker on :5432

cd apps/api
cp .env.example .env
```

Generate the two real secrets and put them in `.env` — the placeholders will
not do:

```bash
openssl rand -base64 48          # -> JWT_SECRET
openssl rand -base64 32          # -> ENCRYPTION_KEY
```

Then:

```bash
pnpm db:migrate
pnpm db:seed                     # demo household, ~6 months of data
cd ../..
pnpm api                         # listens on 0.0.0.0:3000
```

### 2. Point the app at your machine

`localhost` on a phone means the phone. Find your LAN address:

```bash
ipconfig getifaddr en0           # macOS
hostname -I | awk '{print $1}'   # Linux
```

```bash
cp apps/mobile/.env.example apps/mobile/.env
# set EXPO_PUBLIC_API_URL=http://<LAN-IP>:3000/api/v1
```

Also set `PUBLIC_API_URL=http://<LAN-IP>:3000` in `apps/api/.env`, so the mock
bank's consent page hands the phone a URL it can actually reach.

`EXPO_PUBLIC_*` values are inlined at bundle time — restart the dev server after
changing them.

### 3. Run

Install **Expo Go** from the Play Store, then:

```bash
pnpm mobile                      # scan the QR code with Expo Go
```

Sign in with `demo@household.local` / `demo-household-2024`.

### Checkpoint

Work through all of it before going further:

- Overview shows the seeded months, populated donut, non-zero net worth
- Pull-to-refresh runs a sync
- Tap a transaction, recategorise with "apply to similar" — others update
- Budget screen shows pace state; the marker sits at today's position
- Goals show a required monthly amount
- Accounts → "Ladda upp CSV eller Excel" reaches the preview sheet
- Accounts → "Koppla en bank" opens the consent page and returns to the app

---

## Stage B — an installed app, over Tailscale

### 4. Put the API on your tailnet

Install Tailscale on the laptop and the phone, sign both into the same account,
then:

```bash
tailscale ip -4                  # e.g. 100.101.102.103
```

That address is reachable from the phone anywhere, over WireGuard. Nothing is
exposed to the public internet and the financial data never leaves your machine.

Update both env files to the Tailscale address:

```bash
# apps/api/.env
PUBLIC_API_URL=http://100.101.102.103:3000

# apps/mobile/.env
EXPO_PUBLIC_API_URL=http://100.101.102.103:3000/api/v1
```

Confirm from the phone's browser that `http://100.101.102.103:3000/health`
returns `{"status":"ok"}` before building anything.

> **On plain HTTP.** Acceptable *only* because Tailscale already encrypts the
> link. The moment this API is reachable on the public internet it needs TLS —
> it carries bearer tokens and a household's entire financial history.
>
> The Android build sets `usesCleartextTraffic: true` (via
> `expo-build-properties` in `app.json`) because Android 9+ blocks plain HTTP
> by default. If you later move to HTTPS, remove that flag.

### 5. Build the APK

```bash
npm i -g eas-cli
eas login                        # free Expo account
cd apps/mobile
eas init                         # writes extra.eas.projectId into app.json
```

Replace the three `REPLACE_WITH_TAILSCALE_IP` placeholders in
`apps/mobile/eas.json` with your Tailscale IP — the value is baked into the
binary, so a LAN IP here produces an app that only works at home.

```bash
eas build --platform android --profile preview
```

EAS builds in the cloud (~10–20 min on the free tier) and gives you a URL.
Open it on the phone, download the `.apk`, allow "install unknown apps" for
your browser when prompted, install.

No developer account, no fee, no signing setup — EAS generates and stores an
upload keystore for you.

### 6. Verify it is a real build

Stop the Metro dev server, then open the app from your home screen. If it
loads and syncs with Metro stopped, it is a genuine standalone build rather
than a dev client.

---

## Keeping it running

- The API must be running for the app to work. `pnpm api` in a terminal is
  fine to start with; move to a systemd unit or `pm2` once you rely on it.
- Your laptop must be awake. This is the real cost of the Tailscale approach —
  if it becomes annoying, deploying the API is the alternative.
- Re-run `eas build` to ship changes to the phone. For JS-only changes you can
  use `eas update` instead, which is far quicker.

## Troubleshooting

**"Network request failed" in the app.** The phone cannot reach the API.
Check `http://<ip>:3000/health` in the phone's browser first. If that fails,
it is Tailscale or a firewall, not the app.

**Bundle fails after changing something in `packages/shared`.** Metro must
watch the workspace root — that is what `apps/mobile/metro.config.js` sets up.
Also note the shared package is consumed as TypeScript source, so its internal
imports must be extensionless: Metro does not map `./foo.js` to `./foo.ts` the
way TypeScript does.

**Expo Go refuses to open the project.** Expo Go only ever supports the latest
SDK. This project is on SDK 57; if Expo Go has moved on, either upgrade the
project or build a development client (`--profile development`), which is
pinned to whatever SDK you built it with.
