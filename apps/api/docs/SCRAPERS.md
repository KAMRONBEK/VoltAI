# Operator scrapers — endpoints & findings

How VoltAI gets real charger data from the Uzbek operator apps.

## Strategy: off-device HTTP scraping (hybrid)

On-device TLS interception (PCAPdroid/mitm) is **not viable** on the capture phone:
it runs **Android 15, no root**, and the operator apps are **Flutter with cert
pinning** (tokbor even bundles `assets/certs/api.newtokbor.uz.pem`). reFlutter
crashed the app (see the `gate1-flutter-capture-finding` memory).

So instead we reverse-engineered each operator's own API from the shipped APK and
call it directly from the backend — no phone in the request path:

- **Flutter apps** — API host + endpoint paths are string literals in
  `lib/arm64-v8a/libapp.so` (Dart AOT `.rodata`). Extract with `grep -aoE`.
- **React Native apps** — endpoints are readable strings in
  `assets/index.android.bundle`.

Each source lives in `scrapers/apps/<name>.ts` as an `AppScraperConfig`. Adding
`http: [{ url }]` opts it into the off-device scraper (`scrapers/http/`), which
fetches the URL and runs the source's `parseResponse`. The API process scrapes on
boot and on `SCRAPE_CRON` (default every 10 min), upserts raw rows, and merges.

Manual run: `npm run scrape:http` (dry-run, prints counts) /
`npm run scrape:http -- --ingest` (POST to a running API's `/ingest`).

## Status

| Operator | Package | Stack | Auth | Result |
|---|---|---|---|---|
| **Tokbor** | `uz.tokbor.tokbor` | Flutter | login-replay | ✅ ~664 named stations (1127 pins) |
| **Spectre Energy** | `uz.spectreEnergy.uz` | Flutter | none | ✅ ~675 points → ~368 stations |
| **K-Watt** | `org.uicgroup.kwattapp` | Flutter | none | ✅ 88 stations / 205 connectors |
| **Megawatt** | `com.charging123.megawatt` | React Native | **required** | ⛔ blocked (captcha + attestation) |

Combined live: **~1890 raw → ~1117 canonical stations**, verified end-to-end on the
Yandex map on-device (operator-logo markers, clustering, price/power/connectors).

## Working endpoints

### Spectre Energy — `scrapers/apps/spectre-energy.ts`
- `GET https://api.spectre-energy.uz/api/v2/station/statuses/` → array of ~675
  connector-points: `{ id, name, status_id, location:{latitude,longitude},
  energy_power }`. No auth. (The `/stations/` list endpoint omits coordinates;
  `/statuses/` is the geo source.)
- `status_id`: 1 available (most), plus 4 and 8. Kept raw in `rawData`.
- Names carry a `K1`/`K2` connector suffix; `parseResponse` strips it so the merge
  collapses connectors of one physical station.

### K-Watt — `scrapers/apps/k-watt.ts`
- `GET https://app.k-watt.uz/api/v1/core/charge-point-list/` → DRF page of 88
  stations, each with `latitude`/`longitude` (strings), `address`, `landmark`, and
  nested `charge_points[].connectors[]`. No auth.
- Per connector: `type_connection_name` (plug type, e.g. "GB/T DC"), `power_name`
  ("160.0 kW"), `price`, live `status`/`connected`.
- Other `core/` endpoints (auth): `charge-point/`, `charge-task/`,
  `charge-transactions/`, `favorite-charge-points-addres/`, `map`.

### Tokbor — `scrapers/apps/tokbor.ts` (login-replay)

Auth-gated, cracked via **login-replay** (`scrapers/auth/`): reproduce the OTP
login over plain HTTP with the user's own number, store the token, scrape with it.
- Login: `POST /auth/verify-phone-number {phoneNumber, countryCode}` → temp token
  + 5-digit OTP delivered to the user's **Telegram** (`@tokbor_otp_bot`). Then
  `POST /auth/verify-otp {code}` with `Authorization: Bearer <temp>` → access token
  (a **~365-day** JWT, so one login lasts a year; no refresh token is issued).
- CLI: `npm run auth:tokbor -- send "+998…"` then `-- verify <code>`. Token stored
  in `data/auth-tokens.json` (gitignored, mode 0600).
- Stations: `GET https://api.newtokbor.uz/charging-station` **requires** an
  `app-version` header (else 400 "Ilova versiyasi talab qilinadi"). Returns ~1128
  pins `{id, lat, lng, status, type}`. No name in the list.
- **Enrichment**: `npm run enrich:tokbor` fetches `GET /charging-station/{id}` for
  every station (concurrency-limited, uses the stored login) and caches
  name/address/capacity/electricityFee/idleFee to `data/tokbor-details.json`
  (gitignored). The scraper merges that cache with the live status list each tick,
  so pins carry real names ("High town mall 120kW"), power, and UZS pricing. Re-run
  occasionally to pick up new stations. Named multi-connector pins collapse to real
  stations in the merge (~1127 pins → ~664 canonical Tokbor).
- `status`: AVAILABLE / UNAVAILABLE / MAINTENANCE / POWEROFF / EMERGENCY_STOP.
  `type`: DC / HYBRID / AC / ULTRA.

## Blocked (auth-gated) — endpoint known, login not automatable

### Megawatt — `com.charging123.megawatt` (React Native, ecofactor/charging123 platform)
- Host: `https://megawatt-app.ecofactortech.com` (also `megawatt.charging123.com`).
- `GET /api/client/charge-box` → 401 "Unauthorized". No public/map variant found
  (all `/api/*` variants 401). `/client/charge-box` (no `/api`) is a PWA route that
  returns the SPA HTML, not data.
- Login flow (SMS OTP): `POST /api/client/send-code` → `POST /api/client/auth`.
- **Why blocked:** `send-code` requires a **puzzle-slider captcha**
  (`generatePuzzleCaptcha` / `captchaResults` in the RN bundle) **plus hardware
  attestation** (`x-app-attest-key-id`, `HardwareAttestationSignature`). The
  attestation binds the request to the physical device's hardware key, so login
  can't be replayed off-device. Would need on-device Frida (root) or an official
  operator API key.

## Reusing an existing on-device login is not possible (no root)

The apps are already logged in on the phone, but the token lives in each app's
private storage. On a non-rooted device that's unreadable: all 4 apps are **not
debuggable** (so `adb run-as` fails), they don't print the token to logcat, and
mitm is blocked by pinning. Hence login-replay (fresh token) rather than token
extraction.

## Not on the capture device
`pro-tok` and `beon` configs exist but those apps were not installed on the phone,
so their endpoints are undiscovered. `beon` appears in older seed data.
