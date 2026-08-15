# VoltAI

Monorepo for the VoltAI EV charging platform.

| App | Path | Stack |
| --- | --- | --- |
| Mobile | [`apps/mobile`](apps/mobile) | Expo / React Native |
| Website | [`apps/web`](apps/web) | Next.js |
| API | [`apps/api`](apps/api) | Express / SQLite (node-sqlite3-wasm), self-hosted on an always-on Android phone |

## Production architecture

**One always-on Android phone is the backend.** That single device runs, together: the Express
API (Node LTS under Termux, port `8080`, supervised by runit, autostarted by Termux:Boot), the
operator station scrapers (in-process, randomized ~3–5 min self-rescheduling loop, merge inline),
and the database (an embedded SQLite file via `node-sqlite3-wasm`). A **Cloudflare Tunnel dials
out from the phone** to serve `https://api.voltai.uz` — no inbound port, no public IP, no CGNAT
problem, no cloud server.

Only the marketing website (`voltai.uz`) is on Vercel. **MongoDB/Atlas is retired.**

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
                                        │  Express API      :8080          │
                                        │  operator scrapers (in-process,  │
                                        │    randomized 3–5 min loop)      │
                                        │  SQLite file (node-sqlite3-wasm) │
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

### Environment

**Mobile** (`apps/mobile`) — copy [`.env.example`](apps/mobile/.env.example):

```bash
# used by app.config.ts for the Yandex MapKit map (get one at developer.tech.yandex.ru)
YANDEX_MAPKIT_API_KEY=your_key
```

> The map uses `expo-yandex-mapkit`, which ships native code — **Expo Go is not supported**.
> Run a dev build: `npx expo prebuild --clean && npx expo run:android` (or `run:ios`).

**API** (`apps/api`) — copy [`.env.example`](apps/api/.env.example):

```bash
cp apps/api/.env.example apps/api/.env
```

Key values:

- `SQLITE_PATH` — path to the embedded SQLite file (defaults to `./data/voltai.sqlite`)
- `INGEST_TOKEN` — shared secret for `POST /ingest`
- `SCRAPE_MIN_MINUTES` / `SCRAPE_MAX_MINUTES` — randomized scrape interval (default `3`–`5`)
- `CORS_ORIGINS` — allowed origins
- `PORT` — API port. The code default is `3000` for local dev, but the phone deployment uses
  `8080` ([`apps/api/.env.example`](apps/api/.env.example)) because that is what the Cloudflare
  Tunnel ingress targets.

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
- **API**: runs on the always-on Android phone (Termux + runit), exposed as `https://api.voltai.uz`
  by a Cloudflare Tunnel dialing out from the device. **Not on Vercel** — see
  [`apps/api/RUNBOOK.md`](apps/api/RUNBOOK.md) (how) and [`ARCHITECTURE.md`](ARCHITECTURE.md) (why).

> ⏳ **Cutover outstanding (verified 2026-08-15):** the `voltai.uz` zone is still on
> `rdns1/2/3.ahost.uz`, and `api.voltai.uz` is still a CNAME to the retired Vercel deployment
> (HTTP 500). Moving the zone to Cloudflare is Gate 2 — see
> [`apps/api/docs/GATES.md`](apps/api/docs/GATES.md).

This repository is the single source of truth for VoltAI mobile, web, and API.
