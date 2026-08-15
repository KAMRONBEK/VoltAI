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
fetches the URL (following `nextPage` pagination if the endpoint declares it, max 20
pages) and runs the source's `parseResponse`. The API process scrapes once immediately
on boot and then **reschedules itself with a random 3–5 min gap measured after each run
completes** (`SCRAPE_MIN_MINUTES` / `SCRAPE_MAX_MINUTES`, defaults 3 and 5 —
`src/index.ts`), upserts raw rows, and **merges inline at the end of every cycle**.

**Failure semantics (2026-08-16, `scrapers/http/httpScraper.ts` + `src/index.ts`):**
- HTTP 200 but **0 stations parsed** (WAF/HTML challenge page, response-shape change) is a
  **failure**, not an empty success: nothing is upserted, `lastError:<source>` =
  `"0 stations parsed (previous run: N)"`.
- A **non-JSON body** is an error (axios `silentJSONParsing` is off), not a silent 0.
- A stored bearer that the operator **rejects with 401/403** (after one refresh attempt) is a
  `TokenRejectedError` — a **real failure** (`auth.<source>.lastRejectedAt` is stamped, data
  goes stale) — whereas a login-replay source with **no stored token** is *skipped* and shows
  as `no-login`, never as broken.
- Any of the above leaves the source's previous raw rows in place; the merge keeps serving
  them for up to `STATION_TTL_DAYS` (7) and downgrades their connector statuses to `unknown`
  after `STATUS_MAX_AGE_SEC` (1 h) — see `mergeService.ts`.

> The randomized gap is anti-fingerprinting: a perfectly periodic poll from one
> account is trivial for an operator API to flag. Runs never overlap — the next
> delay only starts once the previous scrape has finished.
>
> ⚠️ `SCRAPE_CRON` is **dead** — no code reads it. This doc used to say "every 10 min"
> and `.env.example` said 5; both were wrong. Only the code is right.

Manual run: `npm run scrape:http` (dry-run, prints counts) /
`npm run scrape:http -- --ingest` (POST to a running API's `/ingest`).

## Status

| Operator | Package | Stack | Auth | Result |
|---|---|---|---|---|
| **Tokbor** | `uz.tokbor.tokbor` | Flutter | login-replay | ✅ 677 named stations (1,140 pins) |
| **Spectre Energy** | `uz.spectreEnergy.uz` | Flutter | none | ✅ 687 points → 373 stations |
| **K-Watt** | `org.uicgroup.kwattapp` | Flutter | none | ✅ 88 raw → 87 stations / 205 connectors (DRF pagination followed; per-connector status mapping fixed 2026-08-16 — it used to mark ~75 % of the network offline) |
| **Beon** | `uz.beonapp.uz` | Flutter | login-replay | ✅ 90 sites → 89 stations — logged in 2026-08-07, token valid to 2027-08-07 |
| **Pro-Tok** | `com.fintech_projects.fintech_project1` | Flutter | login-replay | 🟡 wired — auth shape + one-time OTP pending (0 rows) |
| **Megawatt** | `com.charging123.megawatt` | React Native | **required** | ⛔ blocked (hardware attestation — see below) |

Combined live (**snapshot, measured 2026-08-15 on the dev box**): **2,005 raw → 1,226
canonical stations** — tokbor 677, spectre 373, beon 89, k-watt 87 by primary source.
**On the phone (2026-08-16): ~1,222 canonical** from the same four sources, served from
`~/voltai/data/voltai.sqlite`. Verified end-to-end on the Yandex map on-device
(operator-logo markers, clustering, price/power/connectors). Re-check with
`SELECT primary_source, COUNT(*) FROM stations GROUP BY primary_source;` against the DB
(or `curl -s 127.0.0.1:8080/api/health/detail` on the phone for `stations` and per-source
`lastCount`); the numbers drift as operators add sites.

## Working endpoints

### Spectre Energy — `scrapers/apps/spectre-energy.ts`
- `GET https://api.spectre-energy.uz/api/v2/station/statuses/` → array of ~687 (2026-08-15)
  connector-points: `{ id, name, status_id, location:{latitude,longitude},
  energy_power }`. No auth. (The `/stations/` list endpoint omits coordinates;
  `/statuses/` is the geo source.)
- `status_id` mapping (`STATUS_LABELS`): 1 → `available` (most rows), 4 → `maintenance`,
  8 → `unavailable`. Any other id (10 has been seen) is reported as **`unknown`** — never as a
  fake "available" — with a one-time warning in the log so a new code gets noticed. Raw id
  kept in `rawData`.
- Names carry a `K1`/`K2`/`K3` connector suffix; `parseResponse` strips it so the merge groups
  the guns of one physical station into one canonical record — and since 2026-08-16 the merge
  keeps **every** same-source gun as its own connector (it used to de-duplicate them away).

### K-Watt — `scrapers/apps/k-watt.ts`
- `GET https://app.k-watt.uz/api/v1/core/charge-point-list/` → DRF-paginated
  (`{count,next,previous,results}`) list of ~88 stations, each with `latitude`/`longitude`
  (strings), `address`, `landmark`, and nested `charge_points[].connectors[]`. No auth. The
  scraper follows `next` until null (`kwattNextPage`).
- Per connector: `type_connection_name` (plug type, e.g. "GB/T DC"), `power_name`
  ("160.0 kW"), `price` (`price_connector`, `price_parking`, UZS), and an OCPP-style
  **string** `status`. **Status mapping (fixed 2026-08-16):** `available` → available;
  `charging`/`preparing`/`finishing`/`occupied`/`reserved`/`suspendedev`/`suspendedevse` →
  in_use; `unavailable`/`faulted`/`offline` → offline; anything else → unknown. Only
  `charge_point.connected === false` overrides that to offline. **`charge_point.status` is a
  boolean that is FALSE for most healthy points** — reading it as "online" is what marked ~75 %
  of K-Watt offline before the fix.
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
  `app-version` header (else 400 "Ilova versiyasi talab qilinadi"). Returns ~1,140
  pins `{id, lat, lng, status, type}` (2026-08-15). No name in the list.
- **Enrichment**: `npm run enrich:tokbor` fetches `GET /charging-station/{id}` for
  every station (concurrency-limited, uses the stored login) and caches
  name/address/capacity/electricityFee/idleFee to `data/tokbor-details.json`
  (gitignored). The scraper merges that cache with the live status list each tick,
  so pins carry real names ("High town mall 120kW"), power, and UZS pricing. Re-run
  occasionally to pick up new stations. Named multi-connector pins collapse to real
  stations in the merge (~1,140 pins → 677 canonical Tokbor, 2026-08-15).
- `status`: AVAILABLE / UNAVAILABLE / MAINTENANCE / POWEROFF / EMERGENCY_STOP.
  `type`: DC / HYBRID / AC / ULTRA.

### Beon — `scrapers/apps/beon.ts` + `scrapers/auth/beon.ts` (login-replay)

Flutter, base `https://api.v2.beon-app.com`. Auth-gated, **no captcha / no attestation** — same
recipe as Tokbor.
- Login: `POST /auth/login {phoneNumber}` → SMS OTP → `POST /auth/verify-otp {code}` with
  `Authorization: Bearer <tempToken>` → bearer. **The verify call takes ONLY the code**: passing
  `phoneNumber` is rejected ("not allowed") and omitting the bearer is rejected
  ("TOKEN_IS_NOT_PROVIDED") — see `scrapers/auth/beon.ts:11-12`.
- Stations: `GET /map` (bearer). Unauth → `403 AUTHORIZATION_MISSING`. `parseBeon` is defensive
  (array / `{data}` / GeoJSON).
- **Activate:** `npm run auth:beon -- send "+998…"` → `-- verify <code>` → then the scrape loop
  picks it up. **Already done — logged in 2026-08-07; live since.**
- **Resolved (was: token longevity):** Beon's access token is a **~365-day JWT** (iat 2026-08-07,
  exp **2027-08-07**) and **no refresh token is returned**, so `refresh()` is inert — renewal is a
  manual OTP re-login, exactly like Tokbor. Diarise the re-login before 2027-08-07.

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

## Health, auth and per-source state (what the API reports)

`GET /api/health/detail` on the running API is the operator's view of this whole document:

- `sources.<name>.state` — `fresh` (delivered within `STATIONS_STALE_AFTER_SEC`, 900 s),
  `stale` (has a token/needs none but stopped delivering), `never` (enabled, never delivered),
  `no-login` (login-replay source without a stored token — deliberately not scraped),
  `disabled` (no `http` endpoints). Plus `lastIngestAt`, `lastCount`, `lastError`,
  `lastErrorAt`. **Alert on any `stale`** — the top-level `stale` only says the scheduler is
  alive, and `lastScrapeAt` is stamped even when every source failed.
- `auth.<name>` — `hasToken`, `expiresAt`, `daysLeft` (from the JWT `exp`), `obtainedAt`,
  `lastRejectedAt` (set when the operator answered 401/403 to the stored bearer). Token values
  are never exposed. The API also warns at boot when a token has < 30 days left.
- `GET /api/health/ready` answers 503 while the catalog is empty (e.g. right after a fresh
  deploy before the first cycle) — `deploy.sh` waits for it with `smoke.sh --wait 300`.

The token store on the phone is `~/voltai/data/auth-tokens.json` (`AUTH_TOKENS_PATH`, chmod
600), **not in git — the phone holds the only copy** (it is inside the nightly encrypted
backup). Logins are done on the dev box (`npm run auth:<source>`) and shipped with
`bash apps/api/scripts/phone/deploy.sh --force-data`, same for `tokbor-details.json` after
`npm run enrich:tokbor`. Without the file the phone loses Tokbor + Beon — ~766 of ~1,226
canonical stations.

## Reusing an existing on-device login is not possible (no root)

The apps are already logged in on the phone, but the token lives in each app's
private storage. On a non-rooted device that's unreadable: all 4 apps are **not
debuggable** (so `adb run-as` fails), they don't print the token to logcat, and
mitm is blocked by pinning. Hence login-replay (fresh token) rather than token
extraction.

## pro-tok & beon — now discovered
Their APKs were pulled off apkcombo (Flutter, both auth-gated) and wired as login-replay sources
(see the Beon / Pro-Tok sections above). **Beon is live** (OTP login done 2026-08-07). **Pro-Tok is
still waiting** on its one-time OTP login — it is wired but returns 0 rows as of 2026-08-15.

---

## Where this runs

These scrapers are not a separate job: they run **in-process inside the API**, which runs on a single
always-on Android phone under Termux (Node LTS, `127.0.0.1:8080`, runit-supervised, Termux:Boot).
**As of 2026-08-16 that is live on the ASUS Zenfone 10** (deployed via `scripts/phone/deploy.sh`,
backup + restore drill done). The public `https://api.voltai.uz` front (Cloudflare Tunnel) is **not
up yet** — the `voltai.uz` zone is still on ahost.uz (Gate 2, [`GATES.md`](GATES.md)) and the tunnel
token is not configured — so today the scrapers' output is reachable only on the phone or over
`adb forward`. Deployment steps: [`../RUNBOOK.md`](../RUNBOOK.md). Why it is built this way:
[`../../../ARCHITECTURE.md`](../../../ARCHITECTURE.md).
