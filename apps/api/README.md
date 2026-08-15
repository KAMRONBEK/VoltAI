# VoltAI Backend (Uzbekistan EV Station Aggregator)

Express backend with an embedded SQLite database (`node-sqlite3-wasm`), running on an always-on
Android phone under Termux, that aggregates EV charging station data from:

- Operator apps: `tokbor`, `spectre-energy`, `k-watt`, `beon` (live), `pro-tok` (wired, no login
  yet), `megawatt-energy` (blocked by hardware attestation)
- Maps: `yandex-maps`, `google-maps` (dev-box-only Puppeteer scrapers; not wired to the phone)

> **Status (2026-08-16, verified on the phone over ssh):** deployed and supervised on the ASUS
> Zenfone 10 (Android 15) — runit services `voltai-api`, `voltai-watchdog`, `voltai-backup`,
> `sshd` (+ `cloudflared`, down until configured), Termux:Boot hook, real DB at
> `~/voltai/data/voltai.sqlite`, ~1,222 canonical stations, `/api/plan` live with the MyTaxi key,
> backup + restore drill done. **Not yet public:** the `voltai.uz` zone is still on ahost.uz and
> `api.voltai.uz` still points at the retired Vercel function (HTTP 500) — Gate 2 in
> [`docs/GATES.md`](docs/GATES.md) — and the tunnel is not configured. Until then the API answers
> only on the phone (`http://127.0.0.1:8080`) or over `adb forward`.

The API **cannot** run on Vercel — it needs a writable filesystem and a long-lived process
([`docs/ROUTE_PLANNER.md`](docs/ROUTE_PLANNER.md) §8.1). The Vercel entry (`api/index.ts`,
`vercel.json`) and the Mongoose models were deleted from the repo on 2026-08-16.

> This file is a short overview. The documents that hold the detail are:
> - [`/ARCHITECTURE.md`](../../ARCHITECTURE.md) — why the architecture is what it is
> - [`RUNBOOK.md`](RUNBOOK.md) — how to deploy and operate the phone (source of truth for ops)
> - [`docs/SCRAPERS.md`](docs/SCRAPERS.md) — the reverse-engineered operator endpoints
> - [`.env.example`](.env.example) — every env knob, with defaults and comments

## Architecture

- **Scraping pipeline**: in-process inside the API on the phone, on a randomized ~3–5 minute
  self-rescheduling loop (`src/index.ts`), plus once immediately on boot. Sources are the
  operators' own HTTP APIs, reverse-engineered from the shipped APKs — see
  [`docs/SCRAPERS.md`](docs/SCRAPERS.md). The emulator/Appium/mitmproxy/GrizzlySMS path and the
  GitHub Actions schedule are both retired. A source that returns 0 parsed stations, a non-JSON
  body, or a rejected login token (401/403) is recorded as a **failure** (nothing upserted,
  `lastError` set); a login-replay source with no stored token is **skipped** (`no-login`).
- **Storage** (embedded SQLite file, `SQLITE_PATH`; on the phone
  `/data/data/com.termux/files/home/voltai/data/voltai.sqlite`):
  - `raw_stations`: source-level scraped data (rows unseen for `RAW_RETENTION_DAYS`, 30, are pruned)
  - `stations`: canonical merged data by priority (+ `stations_fts` for search)
  - `meta`: freshness stamps (`lastScrapeAt`, `lastMergeAt`, per-source `lastIngestAt`/`lastError`,
    `lastSnapshotAt`)
  - `route_cache`: road geometry from MyTaxi (90 days)
- **Merge** (`src/services/mergeService.ts`, inline at the end of every scrape cycle): priority
  `tokbor` → `spectre-energy` → `megawatt-energy` → `k-watt` → `pro-tok` → `beon` → `yandex-maps`
  → `google-maps`. Same-source sibling rows (Spectre K1/K2/K3, Tokbor multi-post) keep **all**
  their connectors; only cross-source duplicates are de-duplicated. Raw rows older than
  `STATION_TTL_DAYS` (7) are ignored; connector statuses older than `STATUS_MAX_AGE_SEC` (1 h)
  are served as `unknown`. Canonical `_id` = hash of primary source + that source's external id.
- **Listener**: one Express app on `HOST:PORT` — `HOST` defaults to **`127.0.0.1`** (the tunnel
  and the on-device app both talk to loopback), `PORT` defaults to 3000 in code and is `8080` on
  the phone.

## Project Structure

- `src/` Express app, routes, services (merge, planner, routing)
- `src/env.ts` dotenv + env helpers — **blank values count as unset**; imported first by every entrypoint
- `src/db/` embedded SQLite connection (stale-lock recovery, `VACUUM INTO` snapshot) + schema + mappers
- `src/repositories/` data access
- `scrapers/` operator HTTP scrapers (`http/`), auth (login-replay, `auth/`), per-source configs
  (`apps/`), map scrapers (`maps/`, dev box only), and dead capture-era leftovers (`appium/`,
  `proxy/`, `run-app-scraper.ts`)
- `scripts/phone/deploy.sh` ship a build to the phone from the dev box
- `scripts/termux/` phone-side: `bootstrap.sh`, `install-services.sh`, `install-boot.sh`,
  `boot.sh`, `watchdog.sh`, `backup.sh`, `restore.sh`
- `scripts/smoke.sh` end-to-end check against a running API
- `scripts/cloudflared/` tunnel config (locally-managed variant)
- `scripts/stamp-version.cjs` writes `dist/version.json` (commit) at build time → `/api/health/detail → build.commit`
- `apps.json` APKPure links and app metadata — read **only** by the stale
  `scrapers/apk/downloader.ts`; the live per-source configuration is `scrapers/apps/<name>.ts`

## Quick Start (dev box)

1. Install dependencies (from the repo root):

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Set values (all documented in `.env.example`; blank == unset):
- `SQLITE_PATH` — optional; defaults to `./data/voltai.sqlite`
- `MYTAXI_API_KEY` — road routing for `/api/plan` (server-side only; without it plans are
  straight-line "estimated")
- `INGEST_TOKEN` — only if you use `POST /ingest`
- `CORS_ORIGINS` — allowed website origins

`GRIZZLYSMS_API_KEY` is one-time onboarding only. `MONGODB_URI` no longer exists.

4. Run API locally:

```bash
npm run dev            # tsx src/index.ts → http://127.0.0.1:3000
```

Then `bash scripts/smoke.sh http://127.0.0.1:3000`.

## API Endpoints

- `GET /api/health` — liveness only (`{status, commit}`); used by the on-device watchdog
- `GET /api/health/ready` — readiness: **503** when the catalog is empty, the DB is not a real
  file (misconfigured `SQLITE_PATH`), or the scrape scheduler is stale. Point external monitors here.
- `GET /api/health/detail` — `build.commit`, `dbPath`, `dbFileBytes`, `stale`, `lastScrapeAt`,
  `lastMergeAt`, `lastSnapshotAt`, per-source `sources.<name>` (`state`:
  `fresh|stale|never|no-login|disabled`, `lastCount`, `lastError`, `lastErrorAt`) and
  `auth.<name>` (`hasToken`, `expiresAt`, `daysLeft`, `lastRejectedAt`)
- `GET /api/stations?page=1&limit=50` — `limit` max 1000; bad `page`/`limit` → 400; hashed ETags
- `GET /api/stations/statuses` — compact near-real-time status feed (`stale`, `lastMergeAt`)
- `GET /api/stations/nearby?lat=<lat>&lng=<lng>&radius=5000` — bad `radius` → 400
- `GET /api/stations/search?q=<text>`
- `GET /api/stations/:id`
- `GET /api/plan?from=lat,lng&to=lat,lng&range=&soc=&plug=…` — route planner. 400 for bad
  params or endpoints outside the Central-Asia service area, 429 over `PLAN_RATE_PER_MIN` per IP,
  503 + `Retry-After` when `PLAN_MAX_INFLIGHT` is exceeded. `geometry: "estimated"` when routing
  is unavailable. (`GET /api/plan/health` for its own status.)
- `GET /api/client-config` — `minAppVersion`, `message`, `maintenance` from `CLIENT_*` env; read
  by the app at launch (fail-open)
- `POST /ingest` — refused (404) unless the peer is loopback and the request did not come through
  the tunnel; then token-gated (`x-ingest-token`). JSON body parser is mounted only here.

## Scraper Commands (dev box)

- Operator HTTP scrapers (the live path — dry-run, or push to a running API):

```bash
npm run scrape:http
npm run scrape:http -- --ingest      # POST to $API_BASE/ingest (needs INGEST_TOKEN)
```

- One-time login-replay for the OTP-gated sources (then `deploy.sh --force-data` to ship the token):

```bash
npm run auth:tokbor  -- send "+998901234567"
npm run auth:tokbor  -- verify 12345
npm run auth:beon    -- status
npm run auth:pro-tok -- status
```

- Tokbor detail enrichment (names/price/power the list endpoint omits; then `deploy.sh --force-data`):

```bash
npm run enrich:tokbor
```

- Merge canonical stations by hand (the API also does this inline after every scrape):

```bash
npm run merge
```

- Pull and screen operator APKs for endpoint extraction:

```bash
npm run gate:pull
npm run gate:screen
```

- Checks: `npm run lint` (tsc + `merge:check` + `plan:check`), `npm run smoke [-- <base-url>]`.

### Commands that do not do what their name suggests

- `npm run scrape:app` — runs `scrapers/run-app-scraper.ts`: the abandoned Appium + APKPure +
  GrizzlySMS flow. It compiles (it now imports the SQLite repo) but drives a capture design that
  was dropped. Do not use; listed for removal in `ARCHITECTURE.md` §7.
- `npm run scrape:yandex` / `npm run scrape:google` — Puppeteer map scrapers. They write into the
  **dev box's** SQLite (`scrapers/utils/db.ts` → `src/db/sqlite`, whatever `SQLITE_PATH` is
  locally), not into the phone's, and they cannot run under Termux. Nothing pushes their output to
  the phone's `/ingest`; that is not wired up.

## Updating App Sources

The live per-source configuration is `scrapers/apps/<name>.ts` — adding `http: [{ url }]` to a
source's `AppScraperConfig` is what opts it into the in-process scraper (`nextPage` on an endpoint
follows pagination, as K-Watt does). `apps.json` (`apkpureUrl`, `packageName`, `launchActivity`)
is only consumed by the stale APKPure downloader; APKs are now pulled from a real device with
`npm run gate:pull`.

## Scrape schedule

The API process re-scrapes every HTTP-enabled operator on a randomized 3–5 minute interval
(`SCRAPE_MIN_MINUTES` / `SCRAPE_MAX_MINUTES`), rescheduling only after the previous run
completes so runs never overlap and never settle into a detectable rhythm. Each cycle ends with
an inline merge and housekeeping (raw-row and route-cache pruning); the standalone `MERGE_CRON`
only runs when `SCRAPE_ENABLED=false`. A daily `VACUUM INTO` snapshot is written at 02:30 (and
once after boot) for the backup job.

There is no CI scraping: nothing runs in `.github/workflows-disabled/`, which is dead and
scheduled for removal.

## Deployment

The API runs on an always-on Android phone. **[`RUNBOOK.md`](RUNBOOK.md) is the source of truth**
(device prep, `bootstrap.sh`, `deploy.sh`, runit services, boot hook, tunnel, monitoring, backup,
restore, rollback). Everyday redeploy from the dev box:

```bash
bash scripts/phone/deploy.sh            # build → tar over ssh → npm ci (if lock changed) → sv restart → smoke
bash scripts/phone/deploy.sh --data     # first time: also copy auth-tokens.json + tokbor-details.json
```

DNS prerequisite for going public: [`docs/GATES.md`](docs/GATES.md) §Gate 2. Background and
rationale: [`/ARCHITECTURE.md`](../../ARCHITECTURE.md).

## Notes

- The one-time OTP login-replay tokens for `tokbor`, `beon` and `pro-tok` live in the auth token
  store (`data/auth-tokens.json` on the dev box, `~/voltai/data/auth-tokens.json` on the phone;
  gitignored, mode 0600) and must be refreshed by hand when they expire — `/api/health/detail →
  auth.<name>.daysLeft` shows when. See [`docs/SCRAPERS.md`](docs/SCRAPERS.md).
- Megawatt is blocked by hardware attestation and has no working scraper.
- `puppeteer`, `cheerio`, `mongoose` and `string-similarity` are devDependencies; the root
  `.npmrc` sets `puppeteer_skip_download=true`, and the phone installs with `--omit=dev`.
