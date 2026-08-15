# VoltAI Backend (Uzbekistan EV Station Aggregator)

Express backend with an embedded SQLite database (`node-sqlite3-wasm`), running on an always-on
Android phone under Termux, that aggregates EV charging station data from:

- Operator apps: `tokbor`, `spectre-energy`, `megawatt-energy`, `k-watt`, `pro-tok`, `beon`
- Maps: `yandex-maps`, `google-maps` (off-device fallback only)

The API is deployed on a single always-on Android phone (Termux + runit) and exposed at
`https://api.voltai.uz` through an outbound Cloudflare Tunnel. See [`RUNBOOK.md`](RUNBOOK.md).
It **cannot** run on Vercel — the app needs a writable filesystem and a long-lived process
([`docs/ROUTE_PLANNER.md`](docs/ROUTE_PLANNER.md) §8.1).

> This file is a short overview. The three documents that hold the detail are:
> - [`/ARCHITECTURE.md`](../../ARCHITECTURE.md) — why the architecture is what it is
> - [`RUNBOOK.md`](RUNBOOK.md) — how to deploy and operate the phone
> - [`docs/SCRAPERS.md`](docs/SCRAPERS.md) — the reverse-engineered operator endpoints

## Architecture

- **Scraping pipeline**: in-process inside the API on the phone, on a randomized ~3–5 minute
  self-rescheduling loop (`src/index.ts`), plus once immediately on boot. Sources are the
  operators' own HTTP APIs, reverse-engineered from the shipped APKs — see
  [`docs/SCRAPERS.md`](docs/SCRAPERS.md). The emulator/Appium/mitmproxy/GrizzlySMS path and the
  GitHub Actions schedule are both retired. The Puppeteer map scrapers are the off-device
  fallback only (they cannot run under Termux) — and are not wired to the phone today, see
  [Commands that no longer work as documented](#commands-that-no-longer-work-as-documented).
- **Storage** (embedded SQLite file, `SQLITE_PATH`, default `./data/voltai.sqlite`):
  - `raw_stations`: source-level scraped data
  - `stations`: canonical merged data by priority
- **Merge priority**:
  1. app sources (`tokbor`, `spectre-energy`, `megawatt-energy`, `k-watt`, `pro-tok`, `beon`)
  2. `yandex-maps`
  3. `google-maps`

## Project Structure

- `src/` Express app, routes, merge service
- `src/db/` embedded SQLite connection + schema + mappers
- `src/repositories/` data access
- `scrapers/` operator HTTP scrapers, auth (login-replay), map scrapers, apk/sms utils
- `scripts/termux/` phone deployment (bootstrap, runit services, boot, watchdog)
- `scripts/cloudflared/` tunnel config
- `apps.json` APKPure links and app metadata — read **only** by the stale
  `scrapers/apk/downloader.ts`; the live per-source configuration is `scrapers/apps/<name>.ts`

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Set required values:
- `INGEST_TOKEN` — shared secret for `POST /ingest`
- `SQLITE_PATH` — optional; defaults to `./data/voltai.sqlite`
- `CORS_ORIGINS` — allowed website origins

`GRIZZLYSMS_API_KEY` is one-time onboarding only and not needed at steady state (see
`.env.example`). `MONGODB_URI` no longer exists — MongoDB/Atlas is retired.

4. Run API locally:

```bash
npm run dev
```

Health endpoint: `GET /api/health`

## API Endpoints

- `GET /api/health`
- `GET /api/health/detail` — freshness: `lastScrapeAt`, `secondsSinceLastScrape`, `stale`,
  per-source `lastIngestAt`
- `GET /api/stations?page=1&limit=50`
- `GET /api/stations/statuses` — compact near-real-time status feed
- `GET /api/stations/nearby?lat=<lat>&lng=<lng>&radius=5000`
- `GET /api/stations/search?q=<text>`
- `GET /api/stations/:id`
- `GET /api/plan` — route planner (`GET /api/plan/health` for its own status)
- `POST /ingest` — token-gated (`x-ingest-token`); **must never be exposed through the tunnel**

## Scraper Commands

- Operator HTTP scrapers (the live path — dry-run, or push to a running API):

```bash
npm run scrape:http
npm run scrape:http -- --ingest
```

- One-time login-replay for the OTP-gated sources:

```bash
npm run auth:tokbor  -- send "+998901234567"
npm run auth:tokbor  -- verify 12345
npm run auth:beon    -- status
npm run auth:pro-tok -- status
```

- Tokbor detail enrichment (names/price/power the list endpoint omits):

```bash
npm run enrich:tokbor
```

- Merge canonical stations (SQLite-backed; the API also does this inline after every scrape):

```bash
npm run merge
```

- Pull and screen operator APKs for endpoint extraction:

```bash
npm run gate:pull
npm run gate:screen
```

### Commands that no longer work as documented

- `npm run scrape:app` — runs `scrapers/run-app-scraper.ts`, which is Mongoose-bound
  (`src/models/RawStation`) and drives the abandoned Appium + APKPure + GrizzlySMS flow. It
  cannot work now that MongoDB is retired. Listed for removal in `ARCHITECTURE.md`.
- `npm run scrape:yandex` / `npm run scrape:google` — Puppeteer map scrapers. They still write
  **straight into MongoDB** (`scrapers/utils/db.ts` → `src/config/database.ts`), so their output
  currently never reaches the phone's SQLite. They also cannot run under Termux. To feed the
  phone they would have to push via `POST /ingest`; that is not wired up.

## Updating App Sources

The live per-source configuration is `scrapers/apps/<name>.ts` — adding `http: [{ url }]` to a
source's `AppScraperConfig` is what opts it into the in-process scraper. `apps.json`
(`apkpureUrl`, `packageName`, `launchActivity`) is only consumed by the stale APKPure
downloader; APKs are now pulled from a real device with `npm run gate:pull`.

## Scrape schedule

The API process re-scrapes every HTTP-enabled operator on a randomized 3–5 minute interval
(`SCRAPE_MIN_MINUTES` / `SCRAPE_MAX_MINUTES`), rescheduling only after the previous run
completes so runs never overlap and never settle into a detectable rhythm. Each cycle ends with
an inline merge; the standalone `MERGE_CRON` only runs when `SCRAPE_ENABLED=false`.

There is no CI scraping: nothing runs in `.github/workflows-disabled/`, which is scheduled for
removal.

## Deployment

The API runs on an always-on Android phone. Follow [`RUNBOOK.md`](RUNBOOK.md) (Termux bootstrap,
runit services, Cloudflare Tunnel). DNS prerequisite: [`docs/GATES.md`](docs/GATES.md) §Gate 2.
Background and rationale: [`/ARCHITECTURE.md`](../../ARCHITECTURE.md).

> ⏳ **Outstanding (2026-08-15):** `vercel.json` and `api/index.ts` are still in the repo and
> still deploy the broken serverless function that `api.voltai.uz` currently answers with
> HTTP 500. Their deletion is still outstanding — see `ARCHITECTURE.md`.

## Notes

- The one-time OTP login-replay tokens for `tokbor`, `beon` and `pro-tok` live in the auth token
  store (`data/auth-tokens.json`, gitignored, mode 0600) and must be refreshed by hand when they
  expire — see [`docs/SCRAPERS.md`](docs/SCRAPERS.md).
- Megawatt is blocked by hardware attestation and has no working scraper.
