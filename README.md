# VoltAI

Monorepo for the VoltAI EV charging platform.

| App | Path | Stack |
| --- | --- | --- |
| Mobile | [`apps/mobile`](apps/mobile) | Expo / React Native |
| Website | [`apps/web`](apps/web) | Next.js |
| API | [`apps/api`](apps/api) | Express / SQLite (node-sqlite3-wasm), self-hosted on an always-on Android phone |

## Production architecture

**One always-on Android phone is the backend.** That single device runs, together: the Express
API (Node LTS under Termux, bound to `127.0.0.1:8080`, supervised by runit, autostarted by
Termux:Boot), the operator station scrapers (in-process, randomized ~3–5 min self-rescheduling
loop, merge inline), and the database (an embedded SQLite file via `node-sqlite3-wasm`). A
**Cloudflare Tunnel dials out from the phone** to serve `https://api.voltai.uz` — no inbound
port, no public IP, no CGNAT problem, no cloud server.

Only the marketing website (`voltai.uz`) is on Vercel. **MongoDB/Atlas and the Vercel API
function are retired** (their files were removed from the repo on 2026-08-16).

```
  mobile app  ─┐
               ├──►  https://api.voltai.uz  ──►  Cloudflare edge (TLS + cache)
  website     ─┘                                        │
                                                        │  Cloudflare Tunnel
                                                        │  (outbound only — the phone dials out)
                                                        ▼
                                        ┌──────────────────────────────────┐
                                        │  ONE ALWAYS-ON ANDROID PHONE     │
                                        │  Termux + runit + wake-lock      │
                                        │                                  │
                                        │  Express API      127.0.0.1:8080 │
                                        │  operator scrapers (in-process,  │
                                        │    randomized 3–5 min loop)      │
                                        │  SQLite file (node-sqlite3-wasm) │
                                        │  nightly encrypted backup        │
                                        └──────────────────────────────────┘
                                                        │
                                                        ▼
                                        operators' own HTTPS APIs (outbound)
```

Why it is built this way: [`ARCHITECTURE.md`](ARCHITECTURE.md).
How to deploy and operate it: [`apps/api/RUNBOOK.md`](apps/api/RUNBOOK.md).

## Requirements

- Node.js 20+
- npm 10+

## Setup

```bash
npm install
```

(The root `.npmrc` sets `puppeteer_skip_download=true` — puppeteer is a dev-only tool for the
map scrapers and must never download a Chromium build, least of all on the phone.)

### Environment

**Mobile** (`apps/mobile`) — copy [`.env.example`](apps/mobile/.env.example):

```bash
# used by app.config.ts for the Yandex MapKit map (get one at developer.tech.yandex.ru)
YANDEX_MAPKIT_API_KEY=your_key
# optional: point the app at a locally-run API (an http:// value also enables Android cleartext)
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8080
```

> The map uses `expo-yandex-mapkit`, which ships native code — **Expo Go is not supported**.
> Run a dev build: `npx expo prebuild --clean && npx expo run:android` (or `run:ios`).
> There is deliberately no MyTaxi key in the mobile env: routing is called server-side.

**API** (`apps/api`) — copy [`.env.example`](apps/api/.env.example) (it is the documented,
commented reference for every knob; **blank values count as unset**):

```bash
cp apps/api/.env.example apps/api/.env
```

Key values:

| Key | Meaning |
| --- | --- |
| `PORT` / `HOST` | Listener. Code defaults: port `3000`, host **`127.0.0.1`** (loopback only). The phone `.env` uses `8080`, which is what the tunnel and the on-device app target. Set `HOST=0.0.0.0` only to expose the API on the phone's Wi-Fi deliberately. |
| `SQLITE_PATH` | Path to the embedded SQLite file (unset → `./data/voltai.sqlite` relative to `apps/api`). On the phone: `/data/data/com.termux/files/home/voltai/data/voltai.sqlite`. |
| `AUTH_TOKENS_PATH` / `TOKBOR_DETAILS_PATH` | Operator login-replay tokens and the Tokbor name/price cache — not in git, copied to the phone by `deploy.sh --data`. |
| `INGEST_TOKEN` | Shared secret for `POST /ingest` (which is additionally refused unless the request came from loopback and not through the tunnel). |
| `SCRAPE_MIN_MINUTES` / `SCRAPE_MAX_MINUTES` | Randomized scrape interval (default `3`–`5`). `SCRAPE_ENABLED=false` turns scraping off. |
| `STATION_TTL_DAYS` / `STATUS_MAX_AGE_SEC` / `RAW_RETENTION_DAYS` | Data-freshness policy (7 d / 1 h / 30 d): old raw rows are ignored, stale statuses become `unknown`, unseen rows are pruned. |
| `MYTAXI_API_KEY` | Road routing for `/api/plan` — **server-side only**. Without it plans are straight-line "estimated". |
| `CLIENT_MIN_VERSION` / `CLIENT_MESSAGE` / `CLIENT_MAINTENANCE` | `GET /api/client-config`, read by the app at launch (forced update / notice / maintenance banner). |
| `BACKUP_REMOTE` / `BACKUP_RETENTION_DAYS` | rclone remote for the nightly encrypted backup (blank = local + shared-storage copies only). |
| `CORS_ORIGINS` | Allowed website origins (the mobile app is not subject to CORS). |

## Development

```bash
# Mobile (Expo)
npm run mobile

# Website (Next.js)
npm run web

# API (Express)
npm run api
```

## Lint & build

```bash
npm run lint
npm run build
```

Workspace-scoped commands:

```bash
npm run mobile:lint
npm run web:lint
npm run web:build
npm run api:lint
npm run api:build
```

## Deployment

- **Website**: Vercel project `voltai-web` — Root Directory `apps/web` — domain `voltai.uz`
- **API**: runs on the always-on Android phone (Termux + runit), to be exposed as
  `https://api.voltai.uz` by a Cloudflare Tunnel dialing out from the device. **Not on Vercel** —
  see [`apps/api/RUNBOOK.md`](apps/api/RUNBOOK.md) (how) and [`ARCHITECTURE.md`](ARCHITECTURE.md)
  (why). **Push-to-deploy:** every green push to `main` publishes a GitHub Release
  `api-<sha>` (CI), and the phone's `voltai-updater` service pulls, verifies, applies (npm ci if
  the lockfile changed → restart → smoke test) and rolls back on failure — typically live within
  5–8 minutes. Manual/uncommitted deploys: `bash apps/api/scripts/phone/deploy.sh` (same apply
  path over ssh).

> ✅ **CUT OVER — LIVE (2026-08-16 ~13:45 Tashkent).** The `voltai.uz` zone is **Active on Cloudflare**
> (`carmelo`/`lauryn.ns.cloudflare.com`), `api.voltai.uz` → tunnel `voltai-api` (proxied), and
> `https://api.voltai.uz` **serves the phone**: `scripts/smoke.sh https://api.voltai.uz` = ALL OK,
> `cf-cache-status: HIT` on `/api/stations*`, `/api/health*` DYNAMIC (never cached), `/ingest` → 404
> at the edge. Website (apex, DNS-only → Vercel), MX/SPF/DKIM/DMARC all resolve as before. Gate 2 is
> **closed**; everything below that says "still open / HTTP 500 / pending" is history.

> **Status (verified on the phone over ssh, 2026-08-16):** the backend is **deployed and
> supervised** on the ASUS Zenfone 10 (Android 15) — runit services `voltai-api`,
> `voltai-watchdog`, `voltai-backup`, `sshd` (and `cloudflared`, kept down until configured), a
> Termux:Boot hook, a real on-disk SQLite database with ~1,222 canonical stations from Tokbor,
> Spectre, K-Watt and Beon, `/api/plan` working with the MyTaxi key, and one successful encrypted
> backup + restore drill.
>
> ⏳ **Still open (owner actions):** the `voltai.uz` zone is still on `rdns1/2/3.ahost.uz` and
> `api.voltai.uz` is still a CNAME to the retired Vercel deployment (HTTP 500) — moving the zone
> to Cloudflare is Gate 2 ([`apps/api/docs/GATES.md`](apps/api/docs/GATES.md)); the tunnel
> token/config (RUNBOOK §4) is not set up yet. **Until then the API is reachable only on the
> phone itself (`http://127.0.0.1:8080`) or over `adb forward`.** Also outstanding: an rclone
> remote for off-phone backup copies, an external readiness monitor, and removing the lock-screen
> PIN on the server phone (with a PIN, an unattended reboot only recovers after the first unlock).

This repository is the single source of truth for VoltAI mobile, web, and API.
