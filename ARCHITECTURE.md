# VoltAI — Phone-as-Backend Architecture

> Status (per pillar, checked 2026-08-15) — this document is the plan of record for three
> coordinated changes, and they are **not** at the same stage:
>
> | Pillar | Status |
> |---|---|
> | **A. Mobile map** — replace `react-native-maps` (Google) with `expo-yandex-mapkit`. | ✅ **BUILT.** `apps/mobile/package.json` has `expo ^57.0.0`, `react 19.2.3`, `react-native 0.86.2`, `expo-dev-client ~57.0.10`, `expo-yandex-mapkit ^2.22.4`, and no `react-native-maps`. |
> | **B. Data source** — originally: move charger-app JSON capture onto a physical, always-on Android phone, capturing on-device with **no root**. | ⛔ **ABANDONED — decision reversed.** On-device TLS interception was tried and failed (Android 15, no root, Flutter apps with pinning; reFlutter crashed the app). It is **superseded by off-device HTTP scraping** of each operator's own reverse-engineered API, called in-process by the API. Source of truth: [`apps/api/docs/SCRAPERS.md`](apps/api/docs/SCRAPERS.md). The capture design is kept below (§5.1-§5.2) for history only. |
> | **C. Backend** — the same phone **is** the backend: Termux + Node + embedded SQLite + Cloudflare Tunnel serving `api.voltai.uz`. Vercel + MongoDB Atlas are retired. | 🟡 **CODE BUILT, NOT YET DEPLOYED.** The SQLite store, repositories, `/ingest`, `/api/health/detail`, the randomized in-process scraper and the route planner all exist and are committed. What is unbuilt is the *deployment*: Gate 2 (DNS) is still open (§9) and [`apps/api/RUNBOOK.md`](apps/api/RUNBOOK.md) has never been run end-to-end on a phone. |
>
> Deployment **how**: [`apps/api/RUNBOOK.md`](apps/api/RUNBOOK.md). Deployment **why**: this document.
>
> Every external fact below was verified against primary sources during design; the
> load-bearing ones are cited. Of the two hard gates originally listed in §9, Gate 1 is now
> **closed with a negative result** (it gated the abandoned capture pillar); **Gate 2 (DNS) is the
> sole remaining gate** and is the only thing blocking launch.

---

## 1. Honest verdict up front

This architecture is **achievable as an ambitious beta, and defensible as production _only_ with a
cloud read-replica added at launch** (§6). The individual pieces are each verified to work; the
weak point is not any one technology but the **always-online premise of a single consumer phone**:

- Android 15 is documented to kill long-running Termux processes *despite* wake-lock + "Unrestricted"
  battery + recents-pinning ([termux-app#5150](https://github.com/termux/termux-app/issues/5150), open).
- ~~Unattended app-driving needs adb-to-self over Wireless Debugging, whose **port randomizes every
  reboot** (and the toggle resets on many OEMs).~~ — **moot (2026-08-15):** no app is driven any
  more; Pillar B was abandoned (see the status table). Nothing on the phone uses adb at runtime.
- ~~The existing hard-coded pixel taps (`tap:540:640` in `scrapers/apps/*.ts`) **break silently** on any
  charger-app UI update.~~ — **moot (2026-08-15):** same reason. The equivalent live fragility is that
  an operator can change its HTTP API shape or expire a login token; see `apps/api/docs/SCRAPERS.md`.
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
- ℹ️ **DNS status (re-verified 2026-08-15):** `voltai.uz` nameservers are still `rdns1/2/3.ahost.uz`,
  not Cloudflare, and `api.voltai.uz` is still a CNAME to `…vercel-dns-017.com` returning
  HTTP 500 `FUNCTION_INVOCATION_FAILED` → the nameserver move is still a Gate-2 prerequisite
  (see `apps/api/docs/GATES.md`).
- ℹ️ **APK acquisition:** `scrapers/apk/downloader.ts` (APKPure scrape) is stale; use `adb pull` off the
  phone instead (`npm run gate:pull`). Still the right tool — the APKs are now decompiled *statically*
  to extract each operator's HTTP endpoints, rather than instrumented at runtime.

### Reversed decision (2026-08-15)
- ⛔ **On-device TLS capture (Pillar B, §5.1-§5.2) is abandoned.** Gate 1 was run and failed: the
  capture phone is an **ASUS Zenfone 10 (AI2302) on Android 15**, unrooted, and five of the six
  operator apps are Flutter with pinning (tokbor bundles `assets/certs/api.newtokbor.uz.pem`);
  reFlutter crashed the app. The replacement — and the thing actually running today — is off-device
  HTTP scraping of each operator's own API, called in-process by the API on the phone, with no
  capture layer in the request path. **Truth now lives in `apps/api/docs/SCRAPERS.md`.**

---

## 2. Target architecture

> ⚠️ **Redrawn 2026-08-15.** The previous version of this diagram showed the *capture* pipeline
> (charger apps patched with `apk-mitm` and driven by `adb input swipe`, PCAPdroid's VPNService,
> `mitmdump` on `:8050`, `src/scheduler/cron.ts`, `device/adb.ts`, `capture/voltai_mitm.py`, and
> `POST /ingest` as the primary data path). **None of that exists and none of it is the plan** —
> there is no `src/scheduler/`, no `src/device/` and no `capture/` in the repo. It has been replaced
> below by the path that actually runs. See §5.2 and `apps/api/docs/SCRAPERS.md`.

```
┌──────────────── ONE ANDROID PHONE · no root · always on · charger + Wi-Fi ─────────────────┐
│                                                                                             │
│  ┌ Termux (Node LTS) · runit/termux-services · termux-wake-lock · Termux:Boot ────────────┐ │
│  │ src/index.ts — scrape scheduler:                                                        │ │
│  │  (1) one scrape immediately on boot, then SELF-RESCHEDULES with a RANDOM gap of         │ │
│  │      SCRAPE_MIN_MINUTES..SCRAPE_MAX_MINUTES (default 3-5 min), measured AFTER each      │ │
│  │      run completes → runs never overlap and never settle into a detectable rhythm       │ │
│  │                     │                                                                    │ │
│  │                     ▼                                                                    │ │
│  │  scrapers/http/httpScraper.ts ──(2) HTTPS, in-process──▶ each operator's OWN API        │ │
│  │                     │              (tokbor · spectre · k-watt · beon · pro-tok;          │ │
│  │                     │               endpoints reverse-engineered statically from the     │ │
│  │                     │               shipped APKs — docs/SCRAPERS.md)                     │ │
│  │                     ▼                                                                    │ │
│  │  (3) upsertRawStations()  →  raw_stations                                               │ │
│  │                     │                                                                    │ │
│  │                     ▼                                                                    │ │
│  │  (4) mergeStations() INLINE at the end of EVERY cycle (geolib + string-similarity)      │ │
│  │        → stationsRepository.replaceAll() in one BEGIN IMMEDIATE txn → stations          │ │
│  └─────────────────────────────┬───────────────────────────────────────────────────────────┘ │
│  ┌ Node/Express (apps/api) ────┴───────────────────────────────────────────────────────────┐ │
│  │ ONE listener — app.listen(PORT); PORT=8080 on the phone. There is no second listener.    │ │
│  │  public → /api/health  /api/health/detail                                                │ │
│  │           /api/stations  /nearby  /search  /:id  /api/stations/statuses                  │ │
│  │           /api/plan  (+ /api/plan/health)                        (contract preserved)    │ │
│  │  /ingest → mounted on the SAME app (src/app.ts:86). Token-gated (x-ingest-token) and     │ │
│  │           404'd at the cloudflared ingress. It is a side door for off-device pushes,     │ │
│  │           NOT the primary data path.                                                     │ │
│  │  node-cron MERGE_CRON (*/15) → standalone merge: DISABLED whenever SCRAPE_ENABLED is     │ │
│  │           not 'false' (src/index.ts:130-139). Exists only for a scrape-off replica fed   │ │
│  │           purely by /ingest.                                                             │ │
│  │ store: node-sqlite3-wasm  ~/voltai/data/voltai.sqlite  (FTS5, journal=TRUNCATE)           │ │
│  └───────────────────────────────────┬─────────────────────────────────────────────────────┘ │
│  ┌ cloudflared tunnel run voltai-api ─┴────────────────────────────────────────────────────┐ │
│  │ api.voltai.uz → http://127.0.0.1:8080     (outbound QUIC/HTTP2, no inbound ports)        │ │
│  └───────────────────────────────────┬─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────┼──────────────────────────────────────────────────────┘
                                        ▼
                      ┌──── Cloudflare edge · api.voltai.uz ─────┐
                      │ TLS · Cache Rule 5m + stale-if-error 7d  │
                      │ Load Balancer: pool A=phone, B=replica   │◀── cloud read-replica (Turso/libSQL,
                      └──────┬───────────────────────┬───────────┘     read-only, mirrors `stations`)
                      (5)    ▼                       ▼   (6)            ⏳ NOT BUILT (2026-08-15) — §6
          ┌ Expo mobile (Yandex map;              ┌ voltai.uz (Next.js / Vercel, UNCHANGED)
          │ stationsClient.ts UNCHANGED;          │
          │ AsyncStorage offline cache) ──────────┘
```

Two structural properties that de-risk everything else:

1. **Nothing has to reach *in* to the phone.** The phone's IP, Wi-Fi reconnects, CGNAT, and lack of a
   public IP are all irrelevant — `cloudflared` dials *out* to Cloudflare and the tunnel is the only
   **external** ingress. No port-forwarding, no DDNS, no inbound firewall holes.
   > ⏳ **Intended hardening, NOT in the code (2026-08-15):** this section used to claim "Node binds
   > `127.0.0.1` only." It does not. `src/index.ts:13` is `app.listen(port, cb)` with **no host
   > argument**, so Node binds all interfaces and anything on the phone's LAN can hit port 8080
   > directly — including `/ingest`, bypassing the cloudflared ingress rules. Either change the call
   > to `app.listen(port, "127.0.0.1")` (and put the tunnel in front of loopback) or accept the LAN
   > exposure knowingly. The tunnel's outbound-only property above is unaffected either way.
2. **Cloudflare's edge cache is the phone's shock absorber.** A Cache Rule on `/api/stations*`
   collapses N clients to ~1 origin request per 5 minutes. On a single phone CPU this is **mandatory,
   not an optimization.**

---

## 3. Key decisions (reconciled)

| Decision | Choice | Why |
|---|---|---|
| Map library | **`expo-yandex-mapkit`** (`^2.22.4` as shipped), `flavor: "lite"` | Owner requirement; `lite` = map+markers+clustering only (navigation stays with `react-native-map-link`). |
| Map prerequisite | **Expo SDK 54 → 57 upgrade FIRST** — ✅ **DONE** | `expo-yandex-mapkit` peers are `expo>=55, react>=19.2, rn>=0.83`. The old stack (SDK 54 / RN 0.81 / React 19.1) failed all three; shipped stack is `expo ^57.0.0` / `react-native 0.86.2` / `react 19.2.3` / `expo-yandex-mapkit ^2.22.4`. See §4.1. |
| Embedded DB | **`node-sqlite3-wasm`** (TRUNCATE journal, `synchronous=FULL`) | Pure WASM → *nothing compiles* on Termux; its Makefile confirms **FTS5 present**. `better-sqlite3` has no android-arm64 prebuild and open Termux build failures. Resolves the C-vs-D split in favor of the verified-safe option. |
| ~~TLS capture path~~ | ⛔ **SUPERSEDED (2026-08-15)** — no capture path at all | Was: PCAPdroid VPNService → SOCKS5 → own `mitmdump` in Termux. Abandoned with Pillar B. The data path is now direct server-side HTTPS to each operator's own API from `scrapers/http/httpScraper.ts`. See `apps/api/docs/SCRAPERS.md`. |
| ~~APK preparation~~ | ⛔ **SUPERSEDED (2026-08-15)** — APKs are read, not patched | Was: `apk-mitm` re-sign + user-CA patch, `reFlutter`/`objection` for Flutter/pinned apps. reFlutter crashed the app on Android 15. APKs are still pulled (`npm run gate:pull`) but only decompiled **statically** to extract endpoints. |
| Tunnel | **Cloudflare Tunnel** (`pkg install cloudflared`, `edge-ip-version: 4`, `protocol: http2`) | Termux ships an official bionic build; the GitHub glibc binary won't run. Tailscale Funnel can't serve a custom domain; ngrok custom domains are paid + glibc. |
| Resilience | **Cloud read-replica at launch** (Turso/libSQL) behind Cloudflare Load Balancer — ⏳ **NOT BUILT (2026-08-15)**, deferred (§6) | Converts a single-phone outage into "stale-by-one-cycle." The skeptic's top correction. |
| Ports | **One port: 8080** (tunnelled). `/ingest` shares it. | There is no 8787 listener. `src/index.ts` opens a single `app.listen(port)` and `src/app.ts:86` mounts the ingest router on that same app; `INGEST_PORT` is read by no code. `/ingest` is kept off the internet by the cloudflared ingress rule `path: ^/ingest → http_status:404` plus the `x-ingest-token` check. ⏳ A second, loopback-only listener on **8787** remains the recommended hardening but is **NOT built** — and note the ingress rule is a case-sensitive regex while Express routing is not, so `/INGEST` still reaches the origin. |

---

## 4. Pillar A — Map migration (`react-native-maps` → `expo-yandex-mapkit`)

**Sequence it as two commits.** First the SDK upgrade (ship it on the *still-Google* map to isolate
regressions), then the map swap.

### 4.1 ~~Blocker~~: SDK upgrade — ✅ DONE (2026-08-15)
```
expo   ~54.0.24  →  ^57.0.0     ✅ shipped   (SDK 57 is what the library is CI-tested on; RN 0.86)
react   19.1.0   →  19.2.3      ✅ shipped
rn      0.81.5   →  0.86.2      ✅ shipped
                    expo-dev-client   ~57.0.10   ✅ shipped
                    expo-yandex-mapkit ^2.22.4   ✅ shipped
```
**This is no longer a blocker** — the versions above are what `apps/mobile/package.json` has today,
and `react-native-maps` is gone. The procedure below is retained as the record of how it was done.
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

## 5. Pillar B — ~~On-device capture~~ (superseded) + Pillar C — Phone backend

> ⛔ **§5.1 and §5.2 are SUPERSEDED (2026-08-15) and describe a design that was tried and abandoned.**
> They are kept so the reasoning survives — do not mistake them for the running system. What replaced
> them: the API process calls each operator's own reverse-engineered HTTPS endpoint directly, in
> process, on the randomized 3-5 min loop; there is no phone, proxy or app in the request path.
> **Source of truth: [`apps/api/docs/SCRAPERS.md`](apps/api/docs/SCRAPERS.md).**
> §5.3-§5.6 below are still live (with the corrections marked inline).

### 5.1 ~~The user-CA wall (verified) and how we get past it~~ — SUPERSEDED
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
> `scrapers/maps/{yandex,google}.ts` scrapers for that operator (see 5.5). ~~**Assume 1–2 of 6 need a fallback.**~~

**Actual outcome (2026-08-15, per `docs/SCRAPERS.md`):** the estimate was wrong in the worst direction —
on-device capture was dropped for **all six**, not 1–2. Off-device API scraping is what works:

| Operator | Status |
|---|---|
| Tokbor | ✅ live |
| Spectre | ✅ live |
| K-Watt | ✅ live |
| Beon | ✅ live (logged in 2026-08-07, token valid to 2027-08-07) |
| Pro-Tok | 🟡 wired, 0 rows |
| Megawatt | ⛔ blocked by hardware attestation |

Combined live (2026-08-15): **2,005 raw → 1,226 canonical** stations (tokbor 677, spectre 373,
beon 89, k-watt 87).

### 5.2 ~~Capture loop (runtime, on the phone, no PC)~~ — SUPERSEDED, NEVER BUILT
None of the mechanism below exists in the repo: there is no `src/scheduler/`, no `src/device/adb.ts`,
no `capture/voltai_mitm.py` and no `scrapers/apk/patch.ts`. Kept for history:
```
node-cron (*/30, staggered) ─▶ device/adb.ts: am start <pkg> + input swipe (pan/zoom grid over UZ cities)
   ↓ app refetches stations over HTTPS
PCAPdroid VPNService (app_filter = 6 pkgs, block_quic=always, api_key ⇒ no consent prompt)
   ↓ SOCKS5 127.0.0.1:8050
mitmdump -s capture/voltai_mitm.py  →  filter (JSON + containsGeoLikeArray/looksStationLike, ported from
                                        scrapers/proxy/mitmparser.ts) + pid→package→SourceId
   ↓ POST http://127.0.0.1:8787/ingest  {source, url, payload}   (loopback, token-gated, NOT tunnelled)
```
The geo-heuristic was to be the primary gate (not exact URLs), so capture would work before each app's
precise station endpoint was known.

**What runs instead (2026-08-15):**
```
src/index.ts  ─▶ refresh('startup') once on boot, then a random gap of
                 SCRAPE_MIN_MINUTES..SCRAPE_MAX_MINUTES (default 3-5 min) after each run COMPLETES
   ↓
scrapers/http/httpScraper.ts  ─▶ HTTPS to each operator's own API (endpoints extracted statically
                                  from the shipped APKs; login tokens in the auth token store)
   ↓
upsertRawStations()  →  raw_stations   →   mergeStations() INLINE at the end of every cycle → stations
```
`POST /ingest` survives as a useful side door for off-device pushes — **not** as the primary path.

### 5.3 Ingest + parse + merge — maximum reuse
- **`POST /ingest`** → `appScraperConfigs[source].parseResponse(payload)` — the **same**
  `fallbackParseStations` in `scrapers/apps/base.ts:41` that `run-app-scraper.ts:37` uses today.
  **Zero parser rewrite.** → `rawStationsRepository.upsertMany()` = `ON CONFLICT(source, external_id)
  DO UPDATE` (the SQL equivalent of the current `bulkWrite … upsert:true`).
  Still true as of 2026-08-15: the parser itself lives in `scrapers/apps/base.ts`, which is **not** on
  the Outstanding-cleanup list in §7, so deleting `run-app-scraper.ts` does not disturb this path —
  `src/routes/ingest.ts:2` reaches it through `appScraperConfigs`.
- **Merge** (~~`node-cron */15`~~ — see the cadence bullet below) → `services/mergeService.ts`
  **algorithm untouched** (already pure `geolib.distanceMeters` + `nameSimilarity`,
  `similarity>=0.7 ? 80m : 40m`, same `sourcePriority`).
  Only its two I/O lines change: `RawStationModel.find()` → `rawStationsRepository.all()`;
  `deleteMany + insertMany` → `stationsRepository.replaceAll()` inside **one `BEGIN IMMEDIATE`
  transaction** (fixes a real, currently-non-atomic wipe) ~~**with a row-count floor** (abort if
  `merged < 0.5 × previous` so a bad capture can't blank a good dataset)~~.
  - ✅ **`BEGIN IMMEDIATE` is implemented** (`src/repositories/stationRepo.ts:134`).
  - ⏳ **The row-count floor is NOT implemented (2026-08-15)** — there is no comparison against a
    previous count anywhere in `replaceAllStations()` or `mergeStations()`. Until it is built, the
    only thing preventing a bad cycle from blanking the catalog is that `raw_stations` rows are
    never pruned. See risk **R8**.
- **Merge cadence, as actually wired:** the merge runs **inline at the end of every scrape cycle**
  (`src/index.ts:63`). The standalone `node-cron` merge (`MERGE_CRON`, default `*/15`) is explicitly
  **disabled** whenever `SCRAPE_ENABLED` is not `'false'` (`src/index.ts:130-139`); it exists only for
  a scrape-disabled replica fed purely by `/ingest`.

### 5.4 Database (Mongo retired)
`node-sqlite3-wasm`, schema mirrors the Mongoose models with `lat`/`lng` as indexed `REAL` columns
(reassembled to GeoJSON `[lng,lat]` at the serialization boundary so `stationsClient.ts` is untouched).
Contract reproduced in JS:
- **`/nearby`** ($geoNear) → bbox prefilter `lat/lng BETWEEN …` (radius/111320, `cos(lat)` on lng) →
  exact `geolib.getDistance` → sort → `LIMIT 200`, emitting `distanceMeters` on each item.
- **`/search`** ($text) → FTS5 `bm25(name×2, address)`; **`?q=`** on list → same.
- **`_id` must stay 24-hex ObjectId-shaped** because the mobile offline cache keys on `String(id)`.
  The **as-built** formula (`src/repositories/objectId.ts:17`) is
  `sha1(primarySource | name.trim().toLowerCase() | lat.toFixed(4),lng.toFixed(4)).slice(0,24)` —
  **not** `sha1(primarySource|externalId)`; `externalId` is not an input.
  ⚠️ **Correction (2026-08-15):** this id is therefore **not stable across a priority takeover.**
  `mergeService.ts:152-156` rewrites `primarySource`, `name` and the coordinates when a
  higher-priority source wins a station, and any of those three changing (coordinates at the ~11 m
  `toFixed(4)` bucket) yields a new `_id` — churning the mobile cache entry for that station.

Constraints to design around (all verified from the wasm build): **no WAL** (`SQLITE_OS_OTHER=1`, no
shared memory) → `journal_mode=TRUNCATE`, single process; `SQLITE_DQS=0` → single-quote all SQL string
literals; manual `stmt.finalize()` → ~~prepare every statement once at startup, never in a handler~~.

> ⏳ **The startup-prepared-statement design was NOT built (2026-08-15).** Every query goes through
> `db.all` / `db.get` / `db.run` (`stationRepo`, `rawStationRepo`, `metaRepo`, `plannerRepo`,
> `routing/mytaxi`), which prepare **and finalize** a statement per call. That is leak-safe —
> `node-sqlite3-wasm`'s convenience methods finalize internally — so the constraint is satisfied, just
> not by the mechanism described. Reviving the startup-prepare design would be a performance change,
> not a correctness one.

### 5.5 What can't run on the phone
`puppeteer` downloads a glibc Chromium that won't execute under bionic → **`scrapers/maps/{yandex,google}.ts`
run off-device** (laptop/CI) and push via `POST /ingest --remote`.
**Consequence to state plainly:** the "single phone is the *entire* backend" claim is already softened —
the phone is the *primary origin*; the two map-scraper sources and the cloud replica need an external machine.

> ⏳ **NOT WIRED (2026-08-15) — the map scrapers never reach the phone.** The `--remote`/`POST /ingest`
> hand-off above was designed but never built. `scrapers/maps/yandex.ts` and `scrapers/maps/google.ts`
> still write **directly into MongoDB**: both wrap their run in `withDatabase` (`scrapers/utils/db.ts`
> → `src/config/database.ts`, `mongodb://localhost:27017/voltai`) and `scrapers/maps/common.ts:17`
> calls `RawStationModel.bulkWrite`. Nothing in `scrapers/maps/` (or `run-app-scraper.ts`) posts to
> `/ingest`, so **those two sources currently never reach the phone's SQLite** and contribute nothing
> to the 1,226 canonical stations. Either port them onto `POST /ingest` or drop them.

### 5.6 Always-online hardening (necessary, not sufficient — see §1)
Termux/Termux:Boot/Termux:API from **F-Droid** (never Play — signature mismatch). `nodejs-lts` (not
`nodejs`). **Build off-device, ship `dist/`** (never run `tsc`/`tsx` on the phone — OOM-killer). Run
Node + cloudflared under **runit (`termux-services`)** for auto-restart. `termux-wake-lock` at boot;
disable battery optimization + OEM autostart quirks for Termux (the PCAPdroid/Tasker/6-charger-app
entries are moot — Pillar B is abandoned); disable phantom-process killing
(`max_phantom_processes` + `settings_enable_monitor_phantom_procs false`).
~~**Prefer an Android 12–14 device.**~~ Keep it plugged in + "Stay awake while charging"; caseless on a
heatsink; consider a smart-plug charge schedule (battery-swell mitigation).

> ⚠️ **Accepted risk (2026-08-15) — the device is on Android 15.** The phone that exists is an
> **ASUS Zenfone 10 (AI2302) running Android 15** (`docs/GATES.md:7`, `RUNBOOK.md:11-13`; the
> Android-15/no-root half is also in `docs/SCRAPERS.md:7-8`), i.e. exactly the OS this
> section and risk **R1** warn against. The 12–14 preference is not achievable without buying another
> phone, so **R1's stated mitigation is not in force** and the risk is knowingly accepted. The
> Android-15-specific mitigations that *are* available and must all be applied: phantom-process
> killing turned off, battery usage set to **Unrestricted** for Termux, `termux-wake-lock` held from
> boot, and a **scheduled nightly reboot** so a killed process cannot stay dead for a day. On top of
> those, the external uptime check is what actually detects the failure. Naming a replacement
> Android 12–14 device would retire this risk properly.

**Monitoring that matters:** `/api/health` returning `{status:"ok"}` proves *nothing* about data
freshness. Add `/api/health/detail` with per-source `lastIngestAt`; external uptime check
(UptimeRobot/BetterStack) + healthchecks.io dead-man's-switch on the merge cron + a staleness alarm
(any source > 36 h) to Telegram via `termux-api`. Nightly `VACUUM INTO` → gzip → `rclone` → Cloudflare R2,
14-day retention; **test-restore at least once**. `svlogd` log rotation (a full `/data` degrades the whole OS).

> ⏳ **The nightly backup does NOT exist (2026-08-15).** `scripts/termux/` contains no backup script,
> nothing anywhere runs `VACUUM INTO` or `rclone`, no cron/runit service invokes one, `BACKUP_REMOTE`
> is not in `.env.example`, and `bootstrap.sh` does not even install the `sqlite` CLI the command
> above needs — it only does `pkg install … rclone` (`bootstrap.sh:20`) and `mkdir ~/voltai/backups`
> (`bootstrap.sh:39`). **Assume the phone's database is not backed up.** Building
> `scripts/termux/backup.sh` plus its service entry is outstanding work — see the deploy steps in
> [`apps/api/RUNBOOK.md`](apps/api/RUNBOOK.md).

---

## 6. Resilience: cloud read-replica at launch (was "future upgrade")

> ⏳ **NOT BUILT (2026-08-15).** Deferred by owner decision (see §1), not cancelled. `mirrorService.ts`
> does not exist and there is no Load Balancer. Until it is built the phone is a single point of
> failure — acceptable for beta only. Note this is a **read-only follower**, not "move the API to the
> cloud": the phone remains the sole writer and primary origin.

The repository interface is the seam that makes this cheap:

1. **New file** `src/services/mirrorService.ts` — after each successful `replaceAll()`, push the
   `stations` table to **Turso/libSQL** (same SQL dialect; `stationsRepository` re-points via
   `config/sqlite.ts`).
2. **Redeploy `apps/api` to a cloud runtime as a read-only replica** — same `app.ts`, same routes, same
   repositories, with `INGEST_ENABLED=false` and cron disabled by env. **No route code changes.**
3. **`api.voltai.uz` → Cloudflare Load Balancer**, pool A = tunnel (phone, priority 1), pool B = cloud
   replica (priority 2), health-checked on `/api/health`. Failover is automatic; a dead phone becomes
   "stale by one merge cycle," not an outage.
4. **Untouched:** all of `apps/mobile`, `apps/web`, `mergeService.ts`, `scrapers/http/*`.
   (The original list named `capture/voltai_mitm.py` and `device/*` — neither was ever built; see §5.2.)
   The phone stays the only writer; cloud is a follower.

---

## 7. Repo change map

**Mobile** — rewrite `app/(tabs)/index.tsx` (map); tiny edits to `components/stations/station-marker.tsx`;
rewrite `app.config.ts` key injection; `package.json` (`-react-native-maps`, `+expo-yandex-mapkit`,
`+expo-dev-client`, SDK bumps); new `.env`, `eas.json`, `lib/maps/geo.ts`. Update stale
`TECHNICAL_ARCHITECTURE.md` / `FEATURE_SPECIFICATIONS.md`.

**API** — ✅ **new (built):** `src/db/{sqlite.ts,schema.ts,mappers.ts}`,
`src/repositories/{rawStation,station,meta}.ts`, `src/routes/ingest.ts`, `scrapers/http/httpScraper.ts`,
`scripts/termux/*`, `scripts/cloudflared/config.example.yml`, `RUNBOOK.md`.
⛔ **new (never built, Pillar B):** `src/scheduler/cron.ts`, `device/{adb,uiFlow,captureRound,panGrid}.ts`,
`capture/voltai_mitm.py`, `scrapers/apk/patch.ts`, `scripts/adb/pair.sh` — the scrape loop lives inline
in `src/index.ts` instead.
> **Note on `schema.ts` (not `schema.sql`):** the DDL is deliberately inlined as the `SCHEMA_SQL` string
> constant because **`tsc` does not copy `.sql` files into `dist/`**, so reading a sibling `schema.sql`
> at runtime would break the built server. That matters directly for the ship-`dist/`-to-the-phone
> model (§5.6) — do not "tidy" it back into a `.sql` file. Reason recorded at `src/db/schema.ts:1-15`.

**Changed:** `routes/stations.ts` (imports + handler bodies, same shapes),
`app.ts`/`index.ts` (import path only — both now pull `connectDatabase` from `src/db/sqlite`,
`src/app.ts:7`), `mergeService.ts` (2 I/O lines), `package.json` (`+node-cron`,
`+node-sqlite3-wasm`). **Unchanged:** `scrapers/apps/*`, `scrapers/utils/geo.ts`,
`src/types/station.ts`.
> ⏳ **`scrapers/proxy/mitmparser.ts` was never touched (2026-08-15).** The planned "split file-read
> from parse" change belonged to the abandoned capture pillar (§5.2); the file is still exactly as
> committed in `5e40206`. Its only importer is `scrapers/run-app-scraper.ts:7`, which is itself on
> the Outstanding-cleanup list below — nothing the API process runs touches it.
>
> ⏳ **`scrapers/utils/db.ts` was NOT repointed (2026-08-15).** It still imports
> `connectDatabase`/`disconnectDatabase` from `src/config/database.ts` (Mongoose,
> `mongodb://localhost:27017/voltai`) — which is why the map scrapers never reach the phone's
> SQLite (§5.5). It is on the Outstanding-cleanup list below by way of `src/config/database.ts`.

#### ⏳ Outstanding cleanup — NOT DONE (verified 2026-08-15)
An earlier version of this section listed the items below as **"Deleted:"** and as completed
`package.json` changes. **None of it happened** — every file is still tracked on `main`
(`git ls-files apps/api`) and the dependencies are still production dependencies. Treat this as a
checklist, not a record:

- [ ] `src/models/Station.ts`, `src/models/RawStation.ts`
- [ ] `src/config/database.ts`
- [ ] `scrapers/appium/{loginFlow,setup}.ts`
- [ ] `scrapers/run-app-scraper.ts` (and the `scrape:app` script that points at it)
- [ ] all 10 `.github/workflows-disabled/*.yml`
- [ ] `apps/api/vercel.json` — **still live config.** It is what keeps deploying the serverless
      function currently answering `api.voltai.uz` with HTTP 500. Deletion is **outstanding** and is
      an owner decision, not a doc fix.
- [ ] `apps/api/api/index.ts` — same; deleting it also means dropping `"api/**/*.ts"` from the
      `include` array in `apps/api/tsconfig.json`. **Outstanding.**
- [ ] `package.json`: drop `mongoose` (`:37`), and move `puppeteer` (`:40`) and `cheerio` (`:32`) out
      of `dependencies`. ⚠️ **This one has teeth:** `bootstrap.sh` runs
      `npm install --no-workspaces --omit=dev` on the phone, so puppeteer's postinstall downloads a
      glibc Chromium that cannot run under bionic — the most likely cause of a failed first bootstrap.
      (`string-similarity` at `:41` is imported nowhere and is also a candidate.)

**Web** — unchanged (stays on Vercel); only `CORS_ORIGINS` moves to the phone's env.

### Env deltas
- **API adds (in `.env.example` today):** `INGEST_TOKEN`, `SQLITE_PATH`, `AUTH_TOKENS_PATH`,
  `TOKBOR_DETAILS_PATH`, `MERGE_CRON`, `SCRAPE_ENABLED`, `TZ=Asia/Tashkent`, plus
  `SCRAPE_MIN_MINUTES` / `SCRAPE_MAX_MINUTES` (the real scrape knobs — there is no `SCRAPE_CRON`
  anywhere in the code). **Removes:** `MONGODB_URI`.
- ~~`INGEST_PORT=8787`~~ — **struck (2026-08-15):** read by no code and absent from `.env.example`.
  It only ever made sense with the second loopback listener, which is not built (§3, Ports).
- ~~`CAPTURE_CRON`, `PCAPDROID_API_KEY`, `MITM_SOCKS_PORT`~~ — **struck (2026-08-15):** they belong to
  the abandoned capture pillar (§5.2).
- `BACKUP_REMOTE` — ⏳ still unimplemented; see the backup note in §5.6.
- **Mobile adds:** `YANDEX_MAPKIT_API_KEY`. **Removes:** `GOOGLE_MAPS_API_KEY`.

---

## 8. Phased rollout (each phase verifiable, rollback-safe)

**Where we are (2026-08-15): phases 1-3 are DONE; Phase 4 was replaced; Phase 0's DNS half plus
phases 5-7 are what's left.**

- **Phase 0 — safety net:** 🟡 **partly moot.** ~~`mongodump` Atlas → R2 (**seed data for SQLite**)~~ —
  Atlas is retired and is no longer a seed source; the API self-populates, firing a
  `refresh('startup')` immediately on boot (`src/index.ts:22-24`) and then every 3-5 min, so a fresh
  phone serves real data within one cycle. **Still outstanding:** drop `api.voltai.uz` TTL to 60 s and
  **confirm the `voltai.uz` zone is on Cloudflare** (gate §9).
- **Phase 1 — SDK 54→57 only** (map still Google). ✅ **DONE** — see §4.1.
- **Phase 2 — Yandex map swap.** ✅ **DONE.** Exit test was: `git diff --stat apps/mobile/lib` is empty.
- **Phase 3 — API DB-layer swap** (laptop). ✅ **DONE** — SQLite serves all endpoints.
  ⚠️ Both stated exit criteria are dead and were never met as written: the **contract-diff against
  live Vercel** is impossible because that origin returns HTTP 500, so there is no baseline to `jq -S`
  against; and **no `DB_DRIVER=sqlite|mongo` switch was ever implemented** — SQLite is unconditional
  (`src/app.ts:7`), so there is no env-flag rollback.
- ~~**Phase 4 — phone capture** writing to the phone's SQLite (not yet public). Gate §9 (test all 6
  APKs).~~ ⛔ **REPLACED (2026-08-15)** — the capture pillar was abandoned (§5.2). Its replacement,
  in-process HTTP scraping into the phone's SQLite, is built and running.
- **Phase 5 — tunnel on a *staging* hostname** `api2.voltai.uz`; enable Boot/watchdog/backup; **reboot
  and confirm zero-touch recovery**; 72 h soak. ⏳ **NOT STARTED** (and the backup script does not yet
  exist — §5.6). Steps: [`apps/api/RUNBOOK.md`](apps/api/RUNBOOK.md).
- **Phase 6 — DNS cutover** (Cache Rule first, then flip CNAME → `<uuid>.cfargotunnel.com`, proxied).
  ⏳ **BLOCKED on Gate 2** (§9). Rollback is no longer "revert one CNAME to a warm Vercel + Atlas" —
  both are retired and the Vercel function is already returning 500, so **there is nothing to roll
  back to.** Get Phase 5's staging soak right instead.
- **Phase 6b — stand up the cloud replica + Load Balancer** (§6) before declaring production.
  ⏳ **NOT BUILT**, deferred by owner decision.
- **Phase 7 — decommission** Vercel/Atlas, delete dead files (the §7 Outstanding-cleanup checklist),
  add root `ci.yml`. ⏳ **NOT STARTED.**

---

## 9. One remaining gate — DNS

*(Rewritten 2026-08-15. This section used to read "Two hard gates — clear BEFORE writing code." The
code is written and typechecks, and Gate 1 has been answered, so neither premise holds any more.)*

### Gate 2 — DNS · 🔴 **OPEN. The only thing blocking launch.**
**Confirm the `voltai.uz` DNS zone is on Cloudflare nameservers.** A proxied `cfargotunnel` CNAME for
`api.voltai.uz` requires it.

**Measured 2026-08-15:**
- `voltai.uz` nameservers are still `rdns1/2/3.ahost.uz` — **not Cloudflare**.
- `api.voltai.uz` is still a CNAME to `…vercel-dns-017.com`, returning HTTP 500
  `FUNCTION_INVOCATION_FAILED`. That failure is **structural, not a bug to fix**: the app now needs a
  writable filesystem and a long-lived process, which a Vercel function cannot give it.

Steps: [`apps/api/docs/GATES.md`](apps/api/docs/GATES.md) §Gate 2. Deployment that follows it:
[`apps/api/RUNBOOK.md`](apps/api/RUNBOOK.md).

### ~~Gate 1 — TLS interception on all six APKs~~ · ⛔ **CLOSED 2026-08-06 with a NEGATIVE result**
It gated the on-device capture pillar, and that pillar is gone — so **Gate 1 no longer gates
anything.** The test was: per app, `apktool d` + grep for `CertificatePinner|trustkit|libflutter.so|
libssl.so`; install the `apk-mitm` build; watch mitmproxy for TLS resets. It was correctly called "the
single highest-risk unknown in the project," and it is the risk that landed: five of the six apps are
Flutter with pinning, the phone is an unrooted Android 15 device, and reFlutter crashed the app.
**Nothing was decrypted on-device.** The project pivoted to off-device HTTP scraping of the operators'
own APIs — [`apps/api/docs/SCRAPERS.md`](apps/api/docs/SCRAPERS.md) — and that pivot is what shipped.
The `npm run gate:pull` / `gate:screen` scripts survive the pivot: they are still how APKs are pulled
and screened, now for static endpoint extraction.

---

## 10. Risk register (top items)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Android 15+ kills unattended Termux despite all mitigations | 🔴 | ⚠️ **Mitigation NOT in force (2026-08-15).** The device is an ASUS Zenfone 10 on **Android 15** — the "Android 12–14 device" mitigation is unavailable without buying another phone, so this risk is **knowingly accepted**. In force instead: phantom-process killing off, Unrestricted battery, `termux-wake-lock`, nightly scheduled reboot, external uptime alert. Cloud replica (§6) ⏳ not built. See §5.6. |
| R2 | Charger apps pin certs / are Flutter / enforce Play Integrity | 🔴 | ✅ **Materialized, then routed around.** Gate 1 confirmed it (§9). No longer mitigated by reFlutter/objection — the whole capture path was dropped for off-device API scraping (`docs/SCRAPERS.md`). Residual: Megawatt stays ⛔ blocked by hardware attestation. |
| R3 | ~~Wireless-Debugging adb port randomizes on reboot~~ | ⚪ | **Moot (2026-08-15)** — nothing uses adb at runtime; capture pillar abandoned. |
| R4 | ~~Hard-coded pixel taps break on app UI updates, silently~~ | 🟠 | **Restated:** no pixel taps exist, but the equivalent risk is live — an operator changing its HTTP API shape, or a login token expiring, fails silently. Mitigation unchanged: per-source `lastIngestAt` staleness alarms (`/api/health/detail`). Note `stale` alone will **not** catch it: `lastScrapeAt` is stamped every cycle even when every source failed. |
| R5 | Single phone = SPOF | 🟠 | ⏳ **Currently unmitigated.** Nightly R2 backup does **not exist** (§5.6); cold-spare phone not provisioned; cloud replica not built (§6). |
| R6 | `better-sqlite3` won't build on Termux | 🟠 | ✅ **Avoided** — `node-sqlite3-wasm` |
| R7 | Battery swelling from permanent 100 % charge | 🟡 | Smart-plug schedule; caseless; sacrificial/bench-PSU device |
| R8 | Bad scrape cycle wipes canonical `stations` | 🟡 | ✅ `BEGIN IMMEDIATE` implemented (`stationRepo.ts:134`); ⏳ **row-count floor NOT implemented** — see §5.3. R8 is currently mitigated only by the fact that `raw_stations` rows are never deleted. |
| R9 | Phone CPU is the whole capacity plane | 🟡 | Cloudflare Cache Rule on `/api/stations*` (mandatory) — ⏳ not yet created; see [`apps/api/RUNBOOK.md`](apps/api/RUNBOOK.md) §4. |
| R10 | Node binds all interfaces, so the LAN can reach `/ingest` directly | 🟡 | ⏳ **Open (2026-08-15).** `src/index.ts:13` passes no host to `app.listen`. Only `INGEST_TOKEN` protects it from the LAN; the cloudflared `^/ingest` 404 rule covers the tunnel only (and is case-sensitive). See §2, property 1. |

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
