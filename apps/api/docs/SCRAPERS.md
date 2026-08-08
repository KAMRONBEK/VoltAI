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
| **Beon** | `uz.beonapp.uz` | Flutter | login-replay | 🟡 wired — pending one-time OTP login |
| **Pro-Tok** | `com.fintech_projects.fintech_project1` | Flutter | login-replay | 🟡 wired — auth shape + one-time OTP pending |
| **Megawatt** | `com.charging123.megawatt` | React Native | **required** | ⛔ blocked (hardware attestation — see below) |

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

### Beon — `scrapers/apps/beon.ts` + `scrapers/auth/beon.ts` (login-replay)

Flutter, base `https://api.v2.beon-app.com`. Auth-gated, **no captcha / no attestation** — same
recipe as Tokbor.
- Login: `POST /auth/login {phoneNumber}` → SMS OTP → `POST /auth/verify-otp {phoneNumber, otp}` →
  bearer. Endpoints confirmed live; the exact success-body shape is read on the first login
  (`pickToken` scans common shapes).
- Stations: `GET /map` (bearer). Unauth → `403 AUTHORIZATION_MISSING`. `parseBeon` is defensive
  (array / `{data}` / GeoJSON) — finalize connector/status/price mapping after the first response.
- **Activate:** `npm run auth:beon -- send "+998…"` → `-- verify <code>` → then the cron scrapes it.
- **Open question:** token longevity (Tokbor's was ~365 d; Beon's is unverified — confirm on first
  login; if short-lived, `refresh()` tries the common shapes, else re-run the OTP login).

### Pro-Tok — `scrapers/apps/pro-tok.ts` + `scrapers/auth/pro-tok.ts` (login-replay, shape TBD)

Flutter, base `https://crm.protok.uz/api`. Auth-gated.
- Stations: `GET /Connector/List` (bearer). Unauth → `401`. `parseProTok` groups a flat connector
  list into stations by station id / shared coordinates.
- Login endpoint **names** are extracted (`/Sms/SendComfirmCode`, `/Sms/CheckComfirmCode`,
  `/Authorize`) but the request **param shape is unconfirmed** — the CRM serves an SPA for unknown
  routes, so it couldn't be probed blind. The auth module posts best-guess bodies and **prints the
  response keys** on failure so the first real `send`/`verify` reveals the true shape; tighten the
  params then.
- **Activate:** `npm run auth:pro-tok -- send "+998…"` → read the printed keys, fix params if
  needed → `-- verify <code>`.

## Blocked (auth-gated) — endpoint known, login not automatable

### Megawatt — `com.charging123.megawatt` (React Native, ecofactor/charging123 platform)
- Host: `https://megawatt-app.ecofactortech.com` (also `megawatt.charging123.com`).
- `GET /api/client/charge-box` → 401 "Unauthorized". No public/map variant found
  (all `/api/*` variants 401). `/client/charge-box` (no `/api`) is a PWA route that
  returns the SPA HTML, not data.
- Login flow (SMS OTP): `POST /api/client/send-code` → `POST /api/client/auth`.
- **Why blocked (deep finding — do not re-litigate):** TLS is *not* the problem (no cert pinning,
  no `network_security_config.xml`, so a **system**-CA would intercept). The wall is **hardware
  attestation** via a custom Expo module `ExpoAppIntegrity` (Kotlin, `classes5.dex`): Android
  Keystore hardware key attestation (`x-app-attest-key-id`, cert chain to Google's hardware root)
  **+** Play Integrity, with a per-request `x-app-attest-assertion` + `x-app-attest-timestamp`
  signature (high-confidence: the **data GET itself is signed**, so a replayed off-device bearer
  won't work). The contradiction that kills every route: **you cannot both read the TLS and pass
  attestation** — rooting/emulating to install a CA or inject Frida flips `verifiedBootState` in
  the TEE-signed attestation cert, which the server sees and rejects; a stock locked device passes
  attestation but gives you no way to read the traffic. Keybox spoofing (TrickyStore) is being
  killed by Google's 2026 RKP root rotation. **Realistic success ≈ 0%, worsening over time.** Only
  an official operator API key would open this. (Weak fallback: Appium screen-scrape of the live
  logged-in app — no bulk coordinate list, not a real data source.)

## Reusing an existing on-device login is not possible (no root)

The apps are already logged in on the phone, but the token lives in each app's
private storage. On a non-rooted device that's unreadable: all 4 apps are **not
debuggable** (so `adb run-as` fails), they don't print the token to logcat, and
mitm is blocked by pinning. Hence login-replay (fresh token) rather than token
extraction.

## pro-tok & beon — now discovered
Their APKs were pulled off apkcombo (Flutter, both auth-gated) and wired as login-replay sources
(see the Beon / Pro-Tok sections above). They just need a one-time OTP login to go live.
