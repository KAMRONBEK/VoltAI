# VoltAI Backend (Uzbekistan EV Station Aggregator)

Express + MongoDB backend that aggregates EV charging station data from:

- Mobile apps: `tokbor`, `spectre-energy`, `megawatt-energy`, `k-watt`, `pro-tok`, `beon`
- Maps: `yandex-maps`, `google-maps`

The API is intended for deployment on Vercel at `https://api.voltai.uz`.

## Architecture

- **Scraping pipeline**: GitHub Actions (monthly)
  - App scrapers: emulator + mitmproxy + OTP via GrizzlySMS + app automation
  - Map scrapers: Puppeteer for Yandex/Google map results
- **Storage**:
  - `raw_stations`: source-level scraped data
  - `stations`: canonical merged data by priority
- **Merge priority**:
  1. app sources (`tokbor`, `spectre-energy`, `megawatt-energy`, `k-watt`, `pro-tok`, `beon`)
  2. `yandex-maps`
  3. `google-maps`

## Project Structure

- `src/` Express app, models, routes, merge service
- `scrapers/` app scrapers, map scrapers, sms/apk/proxy utils
- `.github/workflows/` monthly jobs + merge trigger
- `api/index.ts` Vercel serverless entry
- `apps.json` APKPure links and app metadata

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
- `MONGODB_URI`
- `GRIZZLYSMS_API_KEY`

4. Run API locally:

```bash
npm run dev
```

Health endpoint: `GET /api/health`

## API Endpoints

- `GET /api/health`
- `GET /api/stations?page=1&limit=50`
- `GET /api/stations/:id`
- `GET /api/stations/search?q=<text>`
- `GET /api/stations/nearby?lat=<lat>&lng=<lng>&radius=5000`

## Scraper Commands

- App scraper (single app):

```bash
npm run scrape:app -- tokbor
```

- Yandex maps:

```bash
npm run scrape:yandex
```

- Google maps:

```bash
npm run scrape:google
```

- Merge canonical stations:

```bash
npm run merge
```

## Updating App Sources

Edit `apps.json` to add/update app entries:

- `apkpureUrl`
- `packageName`
- `launchActivity`

No workflow changes are required when only app metadata changes.

## GitHub Actions Schedule

- App jobs run monthly (staggered) on day 1
- Yandex maps monthly at `0 5 1 * *`
- Google maps monthly at `0 6 1 * *`
- Merge job triggers after scraper workflow success

## Vercel Deployment

1. Import repository into Vercel
2. Ensure `vercel.json` is detected
3. Add environment variables:
   - `MONGODB_URI`
   - `NODE_ENV=production`
   - `CORS_ORIGINS` (optional)
4. Add custom domain `api.voltai.uz`
5. Add DNS `CNAME` record: `api -> <vercel-target>`

## Notes

- App selector coordinates in `scrapers/apps/*.ts` are placeholders and must be tuned with real emulator UI.
- APKPure download formats can change over time; `scrapers/apk/downloader.ts` may need periodic updates.
- OTP and app flows can be flaky; prefer manual `workflow_dispatch` re-runs for failed jobs.
