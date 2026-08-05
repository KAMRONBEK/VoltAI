# VoltAI — Phone-as-Backend Architecture

> Status: **design, not yet built.** This document is the plan of record for three
> coordinated changes:
> 1. **Mobile map:** replace `react-native-maps` (Google) with `expo-yandex-mapkit`.
> 2. **Data source:** move charger-app JSON capture from the emulator/Appium/GrizzlySMS
>    pipeline onto a **physical, always-on Android phone**, capturing on-device with **no root**.
> 3. **Backend:** the same phone **is** the backend — Termux + Node + embedded SQLite +
>    Cloudflare Tunnel serving `api.voltai.uz`. Vercel + MongoDB Atlas are retired.
>
> Every external fact below was verified against primary sources during design; the
> load-bearing ones are cited. Two hard gates (§9) must be cleared **before writing code**.

---

## 1. Honest verdict up front

This architecture is **achievable as an ambitious beta, and defensible as production _only_ with a
cloud read-replica added at launch** (§6). The individual pieces are each verified to work; the
weak point is not any one technology but the **always-online premise of a single consumer phone**:

- Android 15 is documented to kill long-running Termux processes *despite* wake-lock + "Unrestricted"
  battery + recents-pinning ([termux-app#5150](https://github.com/termux/termux-app/issues/5150), open).
- Unattended app-driving needs adb-to-self over Wireless Debugging, whose **port randomizes every
  reboot** (and the toggle resets on many OEMs).
- The existing hard-coded pixel taps (`tap:540:640` in `scrapers/apps/*.ts`) **break silently** on any
  charger-app UI update.
- A phone held at 100 % charge running CPU work is a **physical battery-swelling hazard** in 6–18 months,
  with no non-root charge-limit fix.

The design therefore treats the phone as the **sole writer / primary origin**, and puts a
**read-only cloud replica behind a Cloudflare Load Balancer** so a dead phone degrades to
"stale by one merge cycle" instead of an outage. That single addition (§6) is what makes the whole
thing defensible. Everything else is engineering.

### Resolved decisions (owner, 2026-08-05)
- ✅ **Cloudflare Tunnel** accepted as the reachability front door (phone stays the backend; Cloudflare
  is the doorway + free HTTPS + cache). See §3.
- ✅ **Yandex MapKit platform floors + cost accepted:** OK to drop Android 7.x / iOS 15.x users
  (minSdk 26 / iOS 16.4) and to use the 25K-MAU annual free tier. See §4.2.
- ⏸️ **Cloud read-replica (§6): deferred, not cancelled.** Documented and recommended for real users;
  not in the initial rollout unless/until the owner opts in. Until then the phone is a single point of
  failure — acceptable for beta only.
- ℹ️ **DNS status:** `voltai.uz` is on ahost.uz, not Cloudflare → a nameserver move is a Gate-2
  prerequisite (see `apps/api/docs/GATES.md`).
- ℹ️ **APK acquisition:** `scrapers/apk/downloader.ts` (APKPure scrape) is stale; use `adb pull` off the
  phone instead (`npm run gate:pull`).

---

## 2. Target architecture

```
┌──────────────── ONE ANDROID PHONE · no root · always on · charger + Wi-Fi ─────────────────┐
│                                                                                             │
│  ┌── Charger apps (apk-mitm patched, logged in) ──┐   ┌── Termux (Node LTS + Python) ─────┐ │
│  │ uz.tokbor.tokbor                                │   │ src/scheduler/cron.ts:            │ │
│  │ com.fintech_projects.fintech_project1 (pro-tok) │◀──┤  */30 per app → device/adb.ts     │ │
│  │ uz.spectreEnergy.uz                             │(5)│  am start + input swipe (pan grid)│ │
│  │ com.charging123.megawatt                        │   │  via Wireless-Debugging adb-to-self│ │
│  │ org.uicgroup.kwattapp / uz.beonapp.uz           │   └───────────────┬───────────────────┘ │
│  └──────────────────┬──────────────────────────────┘        (2) adb 127.0.0.1:PORT           │
│         (6) HTTPS    │ to vendor APIs                                                          │
│                      ▼                                                                         │
│  ┌ PCAPdroid VPNService (no root) ───────────────┐   ┌ mitmdump --mode socks5 :8050 ───────┐ │
│  │ app_filter = the 6 packages                   │──▶│  -s capture/voltai_mitm.py           │ │
│  │ socks5 → 127.0.0.1:8050 · block_quic=always   │(7)│  filter: JSON + geo heuristic        │ │
│  │ started by intent w/ api_key (autonomous)     │   └───────────────┬─────────────────────┘ │
│  └───────────────────────────────────────────────┘   (8) POST /ingest │ 127.0.0.1:8787        │
│                                                                        ▼                       │
│  ┌ Node/Express (apps/api) ──────────────────────────────────────────────────────────────┐  │
│  │ ingest-app  :8787 (LOOPBACK ONLY, token-gated) → parseResponse → raw_stations           │  │
│  │ node-cron   */15 merge → mergeService (geolib + string-similarity) → stations           │  │
│  │ public-app  :8080 → /api/health /api/stations /nearby /search /:id   (contract preserved)│  │
│  │ store: node-sqlite3-wasm  ~/voltai/voltai.sqlite  (FTS5, journal=TRUNCATE)               │  │
│  └───────────────────────────────────┬─────────────────────────────────────────────────────┘  │
│  ┌ cloudflared tunnel run voltai-api ─┴────────────────────────────────────────────────────┐  │
│  │ api.voltai.uz → http://127.0.0.1:8080     (outbound QUIC/HTTP2, no inbound ports)         │  │
│  └───────────────────────────────────┬───────────────────────────────────────────────────────┘
└──────────────────────────────────────┼────────────────────────────────────────────────────────┘
                                        ▼
                      ┌──── Cloudflare edge · api.voltai.uz ─────┐
                      │ TLS · Cache Rule 5m + stale-if-error 7d  │
                      │ Load Balancer: pool A=phone, B=replica   │◀── cloud read-replica (Turso/libSQL,
                      └──────┬───────────────────────┬───────────┘     read-only, mirrors `stations`)
                     (10)    ▼                       ▼   (11)
          ┌ Expo mobile (Yandex map;              ┌ voltai.uz (Next.js / Vercel, UNCHANGED)
          │ stationsClient.ts UNCHANGED;          │
          │ AsyncStorage offline cache) ──────────┘
```

Two structural properties that de-risk everything else:

1. **Node binds `127.0.0.1` only.** The phone's IP, Wi-Fi reconnects, CGNAT, and lack of a public IP
   are all irrelevant — `cloudflared` dials *out* to Cloudflare and the tunnel is the only ingress.
   No port-forwarding, no DDNS, no inbound firewall holes.
2. **Cloudflare's edge cache is the phone's shock absorber.** A Cache Rule on `/api/stations*`
   collapses N clients to ~1 origin request per 5 minutes. On a single phone CPU this is **mandatory,
   not an optimization.**

---

## 3. Key decisions (reconciled)

| Decision | Choice | Why |
|---|---|---|
| Map library | **`expo-yandex-mapkit@2.22.2`**, `flavor: "lite"` | Owner requirement; `lite` = map+markers+clustering only (navigation stays with `react-native-map-link`). |
| Map prerequisite | **Expo SDK 54 → 57 upgrade FIRST** | `expo-yandex-mapkit` peers are `expo>=55, react>=19.2, rn>=0.83`. Current stack (SDK 54 / RN 0.81 / React 19.1) **fails all three**. Not optional. |
| Embedded DB | **`node-sqlite3-wasm`** (TRUNCATE journal, `synchronous=FULL`) | Pure WASM → *nothing compiles* on Termux; its Makefile confirms **FTS5 present**. `better-sqlite3` has no android-arm64 prebuild and open Termux build failures. Resolves the C-vs-D split in favor of the verified-safe option. |
| TLS capture path | **PCAPdroid VPNService → SOCKS5 → own `mitmdump` in Termux** | This is PCAPdroid's *documented* decryption path and hands us reassembled `flow.response`. The bundled-addon→loopback-POST variant is kept only as fallback (its outbound-HTTP guarantee is unverified). |
| APK preparation | **`apk-mitm`** re-sign + user-CA patch; **reFlutter / objection** for Flutter/pinned apps | Android 7+ ignores user CAs unless the app's `network_security_config` opts in; re-signing is mandatory, not optional. |
| Tunnel | **Cloudflare Tunnel** (`pkg install cloudflared`, `edge-ip-version: 4`, `protocol: http2`) | Termux ships an official bionic build; the GitHub glibc binary won't run. Tailscale Funnel can't serve a custom domain; ngrok custom domains are paid + glibc. |
| Resilience | **Cloud read-replica at launch** (Turso/libSQL) behind Cloudflare Load Balancer | Converts a single-phone outage into "stale-by-one-cycle." The skeptic's top correction. |
| Ports | public **8080** (tunnelled), ingest **8787** (loopback only) | `/ingest` must never be reachable through the tunnel. |

---

## 4. Pillar A — Map migration (`react-native-maps` → `expo-yandex-mapkit`)

**Sequence it as two commits.** First the SDK upgrade (ship it on the *still-Google* map to isolate
regressions), then the map swap.

### 4.1 Blocker: SDK upgrade
```
expo   ~54.0.24  →  ~57.0.x     (SDK 57 is what the library is CI-tested on; RN 0.86)
react   19.1.0   →  19.2.x
rn      0.81.5   →  0.86.x
```
`cd apps/mobile && npx expo install expo@^57.0.0 --fix && npx expo-doctor`. Re-check workspace
hoisting (`npx expo config --type prebuild`). Realign native deps (reanimated 4, worklets,
gesture-handler, bottom-sheet, lottie) via `--fix`. Keep `reactCompiler` toggle-able for bisecting.

### 4.2 Build & key
- **Dev build is mandatory** — the native module is **not supported in Expo Go**. Add `expo-dev-client`;
  scripts gain `--dev-client`; `npx expo prebuild --clean` + `expo run:*`.
- New env var **`YANDEX_MAPKIT_API_KEY`** (MapKit Mobile SDK key from developer.tech.yandex.ru;
  ~15 min activation lag). Delete `GOOGLE_MAPS_API_KEY`. Inject the plugin in `app.config.ts`
  (never `app.json` — it's committed). Create `apps/mobile/.env` + `eas.json` + an EAS secret.
- **Platform floors rise:** plugin enforces `minSdkVersion 26` (Android 8) and iOS target `16.4`,
  dropping Android 7.x / iOS 15.x users. **Owner decision** + a store minimum-version note.
- **Cost model change:** MapKit free tier = **25K MAU on an annual subscription** (MAU-based, not
  pay-as-you-go). Beyond 25K MAU is a paid license (~$4.8k/yr at the first tier). **Owner decision.**

### 4.3 Code changes — `apps/mobile/app/(tabs)/index.tsx` (the only substantive file)

| Now (`react-native-maps`) | After (`expo-yandex-mapkit`) |
|---|---|
| `import MapView, { Marker, PROVIDER_GOOGLE, Region }` | `import { YandexMapView, Marker, YandexMapViewRef }` |
| `provider={PROVIDER_GOOGLE on Android}` | **deleted** — Yandex is the single renderer both platforms |
| `initialRegion={UZBEKISTAN_REGION}` (lat/lng + deltas) | `cameraPosition={{latitude, longitude, zoom:6.5}}` + `animated={false}` |
| `customMapStyle={DARK_MAP_STYLE}` (Google styler array) | `nightMode` first; optional bespoke `mapStyle` **re-authored** in Yandex `tags/types/elements` schema — the current array is **not portable** |
| `showsUserLocation` / `showsMyLocationButton={false}` | `showUserPosition` / (no native button to suppress) |
| `onPress` | `onMapPress` |
| `<Marker coordinate=…>{<StationMarker/>}` | `<Marker point=… identifier={group.id}>{<StationMarker/>}` |
| `mapRef.animateToRegion(region, 450)` | `await mapRef.current?.setCenter({latitude,longitude,zoom:12.5}, {durationSeconds:0.45})` |

**Marker caveat:** Yandex `<Marker>` snapshots children into a bitmap on **both** platforms (RN-maps did
this only on Android). The existing Android-only `markerReady` / `tracksViewChanges` /
`MARKER_SNAPSHOT_KEY_VERSION` snapshot machine must become platform-agnostic (drop the
`Platform.OS === 'android'` guards). Live/interactive markers use `<MarkerView>` instead — but that
mounts a real RN view per marker and won't scale to hundreds at country zoom, so keep `<Marker>`.

**Clustering:** the current `stationGroups` is *exact-coordinate de-dup* (5-decimal key) feeding the
dual-status split circle — **not** clustering. Keep it verbatim in this migration; the bottom-sheet
selection contract depends on stable `group.id`. Native `<Clusterer minZoom={12}>` is a **separate,
optional Phase-2b PR** layered on top.

**Zero-change files:** `lib/stations/stationsClient.ts`, `station-bottom-sheet.tsx`,
`stations-filter-sheet.tsx`, `filter-fab.tsx`, `offline-banner.tsx`, `types/stations.ts`
(`LatLng` already equals Yandex's `Point`), and the entire `apps/api` + `apps/web` trees.

---

## 5. Pillar B — On-device capture + Pillar C — Phone backend

### 5.1 The user-CA wall (verified) and how we get past it
Android 7+ apps trust **only system CAs** unless their `network_security_config.xml` lists
`<certificates src="user"/>`. A vanilla PCAPdroid CA therefore decrypts **nothing**. The no-root fix
is to change the **app**, not the OS:

1. `scrapers/apk/downloader.ts` (reused) fetches each APK/XAPK from APKPure.
2. **`apk-mitm`** rewrites the NSC to trust user CAs, strips common OkHttp/TrustKit pinning, re-signs.
3. `adb install -r`. Log in **once** per app (manual, or GrizzlySMS once).

> ⚠️ **Flutter apps ignore the Android user/NSC trust store entirely** (BoringSSL bundles its own
> roots) — NSC patching alone is insufficient *even with no pinning*. For those use **reFlutter**
> (patches `libflutter.so`) or **objection patchapk** (Frida gadget, no root). Any app enforcing
> **Play Integrity** on a re-signed APK is **unrecoverable on-device** → fall back to the
> `scrapers/maps/{yandex,google}.ts` scrapers for that operator (see 5.5). **Assume 1–2 of 6 need a fallback.**

### 5.2 Capture loop (runtime, on the phone, no PC)
```
node-cron (*/30, staggered) ─▶ device/adb.ts: am start <pkg> + input swipe (pan/zoom grid over UZ cities)
   ↓ app refetches stations over HTTPS
PCAPdroid VPNService (app_filter = 6 pkgs, block_quic=always, api_key ⇒ no consent prompt)
   ↓ SOCKS5 127.0.0.1:8050
mitmdump -s capture/voltai_mitm.py  →  filter (JSON + containsGeoLikeArray/looksStationLike, ported from
                                        scrapers/proxy/mitmparser.ts) + pid→package→SourceId
   ↓ POST http://127.0.0.1:8787/ingest  {source, url, payload}   (loopback, token-gated, NOT tunnelled)
```
The **geo-heuristic is the primary gate** (not exact URLs), so capture works before each app's precise
station endpoint is known — exactly mirroring today's HAR-based selection.

### 5.3 Ingest + parse + merge — maximum reuse
- **`POST /ingest`** → `appScraperConfigs[source].parseResponse(payload)` — the **same**
  `fallbackParseStations` in `scrapers/apps/base.ts` that `run-app-scraper.ts:37` uses today.
  **Zero parser rewrite.** → `rawStationsRepository.upsertMany()` = `ON CONFLICT(source, external_id)
  DO UPDATE` (the SQL equivalent of the current `bulkWrite … upsert:true`).
- **Merge** (`node-cron */15`) → `services/mergeService.ts` **algorithm untouched** (already pure
  `geolib.distanceMeters` + `nameSimilarity`, `similarity>=0.7 ? 80m : 40m`, same `sourcePriority`).
  Only its two I/O lines change: `RawStationModel.find()` → `rawStationsRepository.all()`;
  `deleteMany + insertMany` → `stationsRepository.replaceAll()` inside **one `BEGIN IMMEDIATE`
  transaction** (fixes a real, currently-non-atomic wipe) **with a row-count floor** (abort if
  `merged < 0.5 × previous` so a bad capture can't blank a good dataset).

### 5.4 Database (Mongo retired)
`node-sqlite3-wasm`, schema mirrors the Mongoose models with `lat`/`lng` as indexed `REAL` columns
(reassembled to GeoJSON `[lng,lat]` at the serialization boundary so `stationsClient.ts` is untouched).
Contract reproduced in JS:
- **`/nearby`** ($geoNear) → bbox prefilter `lat/lng BETWEEN …` (radius/111320, `cos(lat)` on lng) →
  exact `geolib.getDistance` → sort → `LIMIT 200`, emitting `distanceMeters` on each item.
- **`/search`** ($text) → FTS5 `bm25(name×2, address)`; **`?q=`** on list → same.
- **`_id` must stay 24-hex ObjectId-shaped** (`sha1(primarySource|externalId).slice(0,24)`) because the
  mobile offline cache keys on `String(id)` — a content-hash id keeps cache identity stable across merges.

Constraints to design around (all verified from the wasm build): **no WAL** (`SQLITE_OS_OTHER=1`, no
shared memory) → `journal_mode=TRUNCATE`, single process; `SQLITE_DQS=0` → single-quote all SQL string
literals; manual `stmt.finalize()` → prepare every statement once at startup, never in a handler.

### 5.5 What can't run on the phone
`puppeteer` downloads a glibc Chromium that won't execute under bionic → **`scrapers/maps/{yandex,google}.ts`
run off-device** (laptop/CI) and push via `POST /ingest --remote`. This is also the pinning fallback (5.1).
**Consequence to state plainly:** the "single phone is the *entire* backend" claim is already softened —
the phone is the *primary origin*; the two map-scraper sources and the cloud replica need an external machine.

### 5.6 Always-online hardening (necessary, not sufficient — see §1)
Termux/Termux:Boot/Termux:API from **F-Droid** (never Play — signature mismatch). `nodejs-lts` (not
`nodejs`). **Build off-device, ship `dist/`** (never run `tsc`/`tsx` on the phone — OOM-killer). Run
Node + cloudflared under **runit (`termux-services`)** for auto-restart. `termux-wake-lock` at boot;
disable battery optimization + OEM autostart quirks for Termux/PCAPdroid/Tasker/all 6 apps; disable
phantom-process killing (`max_phantom_processes` + `settings_enable_monitor_phantom_procs false`).
**Prefer an Android 12–14 device.** Keep it plugged in + "Stay awake while charging"; caseless on a
heatsink; consider a smart-plug charge schedule (battery-swell mitigation).

**Monitoring that matters:** `/api/health` returning `{status:"ok"}` proves *nothing* about data
freshness. Add `/api/health/detail` with per-source `lastIngestAt`; external uptime check
(UptimeRobot/BetterStack) + healthchecks.io dead-man's-switch on the merge cron + a staleness alarm
(any source > 36 h) to Telegram via `termux-api`. Nightly `VACUUM INTO` → gzip → `rclone` → Cloudflare R2,
14-day retention; **test-restore at least once**. `svlogd` log rotation (a full `/data` degrades the whole OS).

---

## 6. Resilience: cloud read-replica at launch (was "future upgrade")

The repository interface is the seam that makes this cheap:

1. **New file** `src/services/mirrorService.ts` — after each successful `replaceAll()`, push the
   `stations` table to **Turso/libSQL** (same SQL dialect; `stationsRepository` re-points via
   `config/sqlite.ts`).
2. **Redeploy `apps/api` to a cloud runtime as a read-only replica** — same `app.ts`, same routes, same
   repositories, with `INGEST_ENABLED=false` and cron disabled by env. **No route code changes.**
3. **`api.voltai.uz` → Cloudflare Load Balancer**, pool A = tunnel (phone, priority 1), pool B = cloud
   replica (priority 2), health-checked on `/api/health`. Failover is automatic; a dead phone becomes
   "stale by one merge cycle," not an outage.
4. **Untouched:** all of `apps/mobile`, `apps/web`, `mergeService.ts`, `scrapers/apps/*`,
   `capture/voltai_mitm.py`, `device/*`. The phone stays the only writer; cloud is a follower.

---

## 7. Repo change map

**Mobile** — rewrite `app/(tabs)/index.tsx` (map); tiny edits to `components/stations/station-marker.tsx`;
rewrite `app.config.ts` key injection; `package.json` (`-react-native-maps`, `+expo-yandex-mapkit`,
`+expo-dev-client`, SDK bumps); new `.env`, `eas.json`, `lib/maps/geo.ts`. Update stale
`TECHNICAL_ARCHITECTURE.md` / `FEATURE_SPECIFICATIONS.md`.

**API** — **new:** `src/db/{sqlite.ts,schema.sql,mappers.ts}`, `src/repositories/{rawStation,station,meta}.ts`,
`src/routes/ingest.ts`, `src/scheduler/cron.ts`, `device/{adb,uiFlow,captureRound,panGrid}.ts`,
`capture/voltai_mitm.py`, `scrapers/apk/patch.ts`, `scripts/termux/*`, `scripts/adb/pair.sh`,
`scripts/cloudflared/config.yml`, `RUNBOOK.md`. **Changed:** `routes/stations.ts` (imports + 4 handler
bodies, same shapes), `app.ts`/`index.ts`/`scrapers/utils/db.ts` (import path only), `mergeService.ts`
(2 I/O lines), `mitmparser.ts` (split file-read from parse), `package.json`
(`-mongoose`, `+node-cron`, `node-sqlite3-wasm`; `puppeteer`/`cheerio` → devDeps). **Deleted:**
`models/{Station,RawStation}.ts`, `config/database.ts`, `api/index.ts`, `vercel.json`, `scrapers/appium/*`,
`run-app-scraper.ts`, all 10 `.github/workflows-disabled/*`. **Unchanged:** `scrapers/apps/*`,
`scrapers/utils/geo.ts`, `src/types/station.ts`.

**Web** — unchanged (stays on Vercel); only `CORS_ORIGINS` moves to the phone's env.

### Env deltas
- **API adds:** `INGEST_PORT=8787`, `INGEST_TOKEN`, `SQLITE_PATH`, `BACKUP_REMOTE`, `CAPTURE_CRON`,
  `MERGE_CRON`, `PCAPDROID_API_KEY`, `MITM_SOCKS_PORT`, `TZ=Asia/Tashkent`. **Removes:** `MONGODB_URI`.
- **Mobile adds:** `YANDEX_MAPKIT_API_KEY`. **Removes:** `GOOGLE_MAPS_API_KEY`.

---

## 8. Phased rollout (each phase verifiable, rollback-safe)

- **Phase 0 — safety net:** branch; `mongodump` Atlas → R2 (**seed data for SQLite**); drop
  `api.voltai.uz` TTL to 60 s; **confirm the `voltai.uz` zone is on Cloudflare** (gate §9).
- **Phase 1 — SDK 54→57 only** (map still Google). Ship to TestFlight/internal to isolate the upgrade.
- **Phase 2 — Yandex map swap.** Exit test: `git diff --stat apps/mobile/lib` is empty.
- **Phase 3 — API DB-layer swap** (laptop). Exit test: **contract-diff every endpoint** against live
  Vercel with `jq -S` — only `updatedAt`/tie-order may differ. Keep a `DB_DRIVER=sqlite|mongo` env switch
  for rollback.
- **Phase 4 — phone capture** writing to the phone's SQLite (not yet public). Gate §9 (test all 6 APKs).
- **Phase 5 — tunnel on a *staging* hostname** `api2.voltai.uz`; enable Boot/watchdog/backup; **reboot
  and confirm zero-touch recovery**; 72 h soak.
- **Phase 6 — DNS cutover** (Cache Rule first, then flip CNAME → `<uuid>.cfargotunnel.com`, proxied).
  Rollback = revert one CNAME (Vercel + Atlas kept warm 14 days).
- **Phase 6b — stand up the cloud replica + Load Balancer** (§6) before declaring production.
- **Phase 7 — decommission** Vercel/Atlas (pause 30 days first), delete dead files, add root `ci.yml`.

---

## 9. Two hard gates — clear BEFORE writing code

1. **Test TLS interception on all six APKs.** Per app: `apktool d` + grep for
   `CertificatePinner|trustkit|libflutter.so|libssl.so`; install the `apk-mitm` build; watch mitmproxy
   for TLS resets. Flutter apps need reFlutter/Frida even without pinning; Play-Integrity apps are lost
   on-device (→ maps-scraper fallback). **This is the single highest-risk unknown in the project.**
2. **Confirm the `voltai.uz` DNS zone is on Cloudflare nameservers.** A proxied `cfargotunnel` CNAME
   for `api.voltai.uz` requires it; today that record is a Vercel CNAME. If the zone isn't on Cloudflare,
   migrating it is a Phase-0 blocker.

---

## 10. Risk register (top items)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Android 15+ kills unattended Termux despite all mitigations | 🔴 | Android 12–14 device; external uptime alert; **cloud replica (§6)** |
| R2 | Charger apps pin certs / are Flutter / enforce Play Integrity | 🔴 | Gate §9; reFlutter/objection; per-source maps-scraper fallback |
| R3 | Wireless-Debugging adb port randomizes on reboot | 🔴 | `adb tcpip 5555`; else budget manual re-pair; watchdog checks `adb devices` |
| R4 | Hard-coded pixel taps break on app UI updates, silently | 🟠 | Per-source `lastIngestAt` staleness alarms |
| R5 | Single phone = SPOF | 🟠 | Nightly R2 backup; **cold-spare phone on same named tunnel**; cloud replica |
| R6 | `better-sqlite3` won't build on Termux | 🟠 | **Avoided** — `node-sqlite3-wasm` |
| R7 | Battery swelling from permanent 100 % charge | 🟡 | Smart-plug schedule; caseless; sacrificial/bench-PSU device |
| R8 | Bad capture wipes canonical `stations` | 🟡 | `BEGIN IMMEDIATE` + row-count floor |
| R9 | Phone CPU is the whole capacity plane | 🟡 | Cloudflare Cache Rule on `/api/stations*` (mandatory) |

---

### Primary sources
[expo-yandex-mapkit](https://github.com/softwhere-uz/expo-yandex-mapkit) ·
[npm registry](https://registry.npmjs.org/expo-yandex-mapkit) ·
[Expo SDK 57](https://expo.dev/changelog/sdk-57) ·
[Yandex MapKit tariffs](https://yandex.com/maps-api/products/mapkit) ·
[apk-mitm](https://github.com/niklashigi/apk-mitm) ·
[PCAPdroid TLS decryption](https://emanuele-f.github.io/PCAPdroid/tls_decryption.html) ·
[PCAPdroid app API](https://github.com/emanuele-f/PCAPdroid/blob/master/docs/app_api.md) ·
[Flutter ignores user CA store (mitmproxy#7836)](https://github.com/mitmproxy/mitmproxy/discussions/7836) ·
[node-sqlite3-wasm](https://github.com/tndrle/node-sqlite3-wasm) ·
[better-sqlite3 Termux build fail #857](https://github.com/WiseLibs/better-sqlite3/issues/857) ·
[cloudflared on Termux](https://gist.github.com/Erisa/4015ae12211434b8f2f64ac1d731b830) ·
[cloudflared SRV bug on Termux](https://community.cloudflare.com/t/cloudflared-tunnel-fails-srv-lookup-on-1-53-refused-termux-android-v2025-8-1/837267) ·
[Android 15 kills Termux (termux-app#5150)](https://github.com/termux/termux-app/issues/5150) ·
[Termux:Boot](https://wiki.termux.com/wiki/Termux:Boot)
