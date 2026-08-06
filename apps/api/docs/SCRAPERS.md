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
| **Spectre Energy** | `uz.spectreEnergy.uz` | Flutter | none | ✅ ~675 points → ~368 stations |
| **K-Watt** | `org.uicgroup.kwattapp` | Flutter | none | ✅ 88 stations / 205 connectors |
| **Tokbor** | `uz.tokbor.tokbor` | Flutter | **required** | ⛔ blocked |
| **Megawatt** | `com.charging123.megawatt` | React Native | **required** | ⛔ blocked |

Combined live: **763 raw → 455 canonical stations**, verified end-to-end on the
Yandex map on-device.

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

## Blocked (auth-gated) — endpoints known, need a token

Both return **401** for their station data. On-device passive capture is blocked
(pinning + no root). The clean path is **login-replay**: reproduce the app's OTP
login over plain HTTP with the user's own number, store the refresh token, and mint
access tokens for the scraper. This needs the user's participation (OTP) and their
consent to hold the token — not done yet.

### Tokbor — `uz.tokbor.tokbor` (Flutter)
- Base: `https://api.newtokbor.uz`. Live feed: `GET https://ocpp.newtokbor.uz/sse/stations/`
  (SSE) → 401 "Invalid or missing token". REST `GET /charging-station` and
  `/charging-station/options` → 401.
- OTP is delivered via a **Telegram bot** (`@tokbor_otp_bot`), not SMS — harder to
  automate than an SMS OTP.
- `https://api.cpanel.newtokbor.uz/api/stations` exists but requires a `secret`
  query param (not found in the public admin bundle).

### Megawatt — `com.charging123.megawatt` (React Native, ecofactor/charging123 platform)
- Host: `https://megawatt-app.ecofactortech.com` (also `megawatt.charging123.com`).
- `GET /api/client/charge-box` → 401 "Unauthorized". No public/map variant found
  (all `/api/*` variants 401). `/client/charge-box` (no `/api`) is a PWA route that
  returns the SPA HTML, not data.
- Login flow (SMS OTP): `POST /api/client/send-code` → `POST /api/client/auth`,
  then `Authorization` bearer on `/api/client/charge-box`.

## Not on the capture device
`pro-tok` and `beon` configs exist but those apps were not installed on the phone,
so their endpoints are undiscovered. `beon` appears in older seed data.
