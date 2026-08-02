# VoltAI

Monorepo for the VoltAI EV charging platform.

| App | Path | Stack |
| --- | --- | --- |
| Mobile | [`apps/mobile`](apps/mobile) | Expo / React Native |
| Website | [`apps/web`](apps/web) | Next.js |
| API | [`apps/api`](apps/api) | Express / MongoDB |

## Requirements

- Node.js 20+
- npm 10+

## Setup

```bash
npm install
```

### Environment

**Mobile** (`apps/mobile`)

```bash
# used by app.config.ts for Google Maps
GOOGLE_MAPS_API_KEY=your_key
```

**API** (`apps/api`) — copy [`.env.example`](apps/api/.env.example):

```bash
cp apps/api/.env.example apps/api/.env
```

Key values:

- `MONGODB_URI` — MongoDB connection string
- `CORS_ORIGINS` — allowed origins
- `PORT` — local API port (default `3000`)

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
- **API**: Vercel project `voltai-api` — Root Directory `apps/api` — domain `api.voltai.uz`

This repository is the single source of truth for VoltAI mobile, web, and API.
