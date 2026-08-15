# VoltAI - Technical Architecture & Implementation Plan

> **Document status (updated 2026-08-16).** This was written before the system was built and
> planned a PostgreSQL + Redis + Docker/AWS backend with JWT user accounts. None of that was
> built, and none of it is the plan. The sections below have been corrected to the shipped
> architecture; the week-by-week implementation phases are kept as historical record and
> labelled as such. As of 2026-08-16 the backend described here is **deployed and supervised on
> the phone**; only the public `api.voltai.uz` cutover (DNS + tunnel) is still open.
>
> Authoritative companions: **why** the architecture is what it is —
> [`/ARCHITECTURE.md`](../../ARCHITECTURE.md); **how** the backend is deployed and operated —
> [`apps/api/RUNBOOK.md`](../api/RUNBOOK.md).

## System Architecture Overview

```
┌──────────────────────┐        ┌───────────────────────────┐
│      Mobile App      │  HTTPS │     Cloudflare edge       │
│  Expo / React Native │───────▶│  TLS termination + cache  │
│    Yandex MapKit     │        │  (Cache Rules: stations,  │
│                      │        │   plan, client-config)    │
└──────────────────────┘        └─────────────┬─────────────┘
           │                                  │ outbound tunnel
           │                                  │ (cloudflared dials OUT;
┌──────────▼───────────┐                      │  no inbound port, no public IP)
│    Local Storage     │        ┌─────────────▼─────────────┐
│    (AsyncStorage)    │        │  ONE always-on Android    │
│  garage, saved trips │        │  phone — Termux + runit   │
│  prefs, offline cache│        │                           │
└──────────────────────┘        │  Express API :8080        │
                                │  embedded SQLite file     │
                                │   (node-sqlite3-wasm)     │
                                │  in-process scrapers      │
                                │   (random 3-5 min loop)   │
                                └─────────────┬─────────────┘
                                              │ HTTPS (server-side only)
                                ┌─────────────▼─────────────┐
                                │  Operator APIs (tokbor,   │
                                │  spectre, k-watt, beon…)  │
                                │  MyTaxi routing           │
                                └───────────────────────────┘
```

Notes on this diagram, because it is the part people get wrong:

- **There is no PostgreSQL and no Redis.** The database is a single embedded SQLite file on the
  phone; the "cache layer" is Cloudflare's edge cache, driven by the origin's own
  `Cache-Control` / `ETag` headers plus an explicit Cache Rule.
- **There is no cloud API host.** Only the marketing website (`voltai.uz`) is on Vercel.
- The mobile app talks to exactly one backend: `https://api.voltai.uz`. Yandex MapKit is the
  only third party the app itself calls (MyTaxi routing is called by the backend, never by the app).
- ⏳ **The Cloudflare half is not up yet (2026-08-16):** the phone side is running, but the
  `voltai.uz` zone is still on ahost.uz and `api.voltai.uz` still points at a retired Vercel
  function (HTTP 500). Until Gate 2 + the tunnel are done, only an app on the same phone (or a
  dev build via `adb reverse`) reaches the API, at `http://127.0.0.1:8080`.

## Frontend Architecture (React Native/Expo)

### Project Structure

As shipped (`apps/mobile`):

```
app/
├── (tabs)/
│   ├── index.tsx          # Map tab
│   ├── route.tsx          # Route / trip planner tab
│   ├── explore.tsx        # Settings tab
│   └── _layout.tsx        # Tab navigation
├── plan/
│   ├── pick.tsx           # Drop-a-pin start/end picker
│   ├── results.tsx        # Plan results + charging stops
│   └── history.tsx        # Saved trips (AsyncStorage)
├── garage/
│   ├── index.tsx          # Vehicle list
│   └── [id].tsx           # Vehicle editor
└── _layout.tsx            # Root layout (state hydration)
components/
├── ui/                    # Reusable UI components
└── stations/              # Station sheet + marker UI
hooks/                     # Custom React hooks
lib/                       # Domain logic: stations, plan, vehicles, storage, theme
constants/                 # App constants and themes
```

The charger detail view is a `@gorhom/bottom-sheet` inside the Map tab, not a `modal.tsx` route.

### Core Dependencies (shipped)

The original list here was a wishlist and none of the map packages in it were used. What is
actually in `apps/mobile/package.json`:

```json
{
  "dependencies": {
    "expo-yandex-mapkit": "map view, markers and native Clusterer",
    "expo-location": "location permission and fixes",
    "react-native-map-link": "hand off navigation to an installed maps app",
    "@gorhom/bottom-sheet": "station detail + filter sheets",
    "@react-native-async-storage/async-storage": "garage, saved trips, prefs, offline cache",
    "@react-native-community/netinfo": "offline banner",
    "jotai": "state management (atoms, explicit hydration)",
    "@expo/vector-icons": "icons"
  }
}
```

No `react-native-maps`, no `react-native-maps-directions`, no `react-native-maps-clustering`,
no `zustand`, no `axios` (the API client uses `fetch`).

### State Management Structure

State is a set of jotai atoms, not one monolithic store: `lib/vehicles/garage-atoms.ts`,
`lib/plan/plan-history-atoms.ts` and `lib/plan/tripPoints.ts`. Persistence is explicit
(hydrated once in `app/_layout.tsx`, written back through `lib/storage/jsonStorage.ts`) rather
than `atomWithStorage`, because AsyncStorage is async and the first frame must not flash empty.

The sketch below is kept for shape only — note there is **no `user`**: the app is account-free.

```typescript
// conceptual shape of the atom set
interface AppState {
  // Owner data (device-local, never synced)
  vehicles: VehicleProfile[];
  preferences: UserPreferences;
  
  // Map state
  currentLocation: Coordinate | null;
  mapRegion: MapRegion;
  selectedStation: ChargingStation | null;
  
  // Charger data
  stations: ChargingStation[];
  filteredStations: ChargingStation[];
  
  // Trip planning
  currentTrip: TripPlan | null;
  routePolyline: Coordinate[];
  
  // UI state
  isLoading: boolean;
  error: string | null;
}
```

## Backend Architecture

The backend is a single Node/Express process running on the always-on Android phone. It serves
the HTTP API, runs the operator scrapers in-process, and owns the SQLite file — one process, one
port. See [`/ARCHITECTURE.md`](../../ARCHITECTURE.md) for the reasoning and
[`apps/api/RUNBOOK.md`](../api/RUNBOOK.md) for the deployment steps.

### API Structure

As shipped (`apps/api`):

```
src/
├── app.ts                # Express app: routes, CORS, /api/health{,/ready,/detail}, error handler
├── index.ts              # Listener (127.0.0.1 by default) + the randomized scrape/merge loop,
│                         # daily VACUUM INTO snapshot, graceful shutdown
├── env.ts                # dotenv + env helpers (blank == unset)
├── routes/               # /api/stations, /api/plan, /api/client-config, /ingest
├── services/             # Merge, route planning, MyTaxi routing
├── repositories/         # Data access over SQLite
├── db/                   # sqlite.ts (connection, stale-lock recovery, snapshot) + schema.ts + mappers
└── utils/                # Utilities
scrapers/http/            # Operator API scrapers, called in-process
scrapers/auth/            # Login-replay token store (Tokbor, Beon, Pro-Tok)
scripts/phone/deploy.sh   # Dev box → phone deploy (build, tar over ssh, npm ci, sv restart, smoke)
scripts/termux/           # Phone bootstrap, runit services, boot hook, watchdog, backup, restore
scripts/smoke.sh          # End-to-end check
scripts/cloudflared/      # Tunnel ingress config
```

There is no `middleware/auth` — there is no user authentication to do (see Security & Privacy).

**Cleanup status (2026-08-16):** `src/models/`, `src/config/database.ts`, `apps/api/api/index.ts`
and `apps/api/vercel.json` (the MongoDB/Vercel leftovers) **have been deleted**; `mongoose`,
`puppeteer`, `cheerio` are devDependencies now. Still tracked and dead: `scrapers/appium/`,
`scrapers/run-app-scraper.ts`, `scrapers/proxy/mitmparser.ts`, `.github/workflows-disabled/`
(`/ARCHITECTURE.md` §7).

### Database Schema

The PostgreSQL DDL that used to sit here was never built and PostgreSQL is not part of this
system. **The real schema is `apps/api/src/db/schema.ts`** — SQLite, held in one embedded file
via `node-sqlite3-wasm`, and it is the single source of truth. Shape, in summary:

| Table | What it holds |
| --- | --- |
| `raw_stations` | One row per operator record, as scraped. Unique on `(source, external_id)`. Rows unseen for `RAW_RETENTION_DAYS` (30) are pruned; rows older than `STATION_TTL_DAYS` (7) are ignored by the merge; statuses older than `STATUS_MAX_AGE_SEC` (1 h) are served as `unknown`. |
| `stations` | The canonical, merged catalog the API serves. Same-source sibling rows (Spectre K1/K2/K3, Tokbor posts) keep all their connectors; only cross-source duplicates are de-duplicated. |
| `meta` | Housekeeping stamps — `lastScrapeAt` / `lastMergeAt` / `lastSnapshotAt`, per-source `lastIngestAt` / `lastCount` / `lastError` — surfaced by `/api/health/detail` and `/api/health/ready`. |
| `stations_fts` | External-content FTS5 index over `stations(name, address)`, rebuilt after each merge; backs `/api/stations/search`. |
| `route_cache` | Road geometry from the routing provider, keyed by origin/destination quantized to 3 dp. Long-lived on purpose — a repeated trip costs zero routing calls. |

Details worth knowing before touching it:

- **`lat` and `lng` are separate indexed `REAL` columns**, not a geometry type. The nearby query
  needs indexable scalars for its bounding-box prefilter; GeoJSON `[lng, lat]` is reassembled at
  the serialization boundary.
- **`stations._id` is a 24-hex hash of the primary source + that source's own external id**
  (`src/repositories/objectId.ts`), kept ObjectId-shaped so the mobile offline cache keys stay
  stable across renames and re-enrichment (it used to hash name + coordinates).
- The DDL is inlined as the `SCHEMA_SQL` string constant rather than a `.sql` file on purpose:
  `tsc` does not copy `.sql` files into `dist/`, and `dist/` is what gets shipped to the phone.
- There are **no user tables.** No `users`, no `user_vehicles`, no `user_favorites` — the app is
  account-free and vehicle profiles and saved trips live in on-device AsyncStorage.

## Implementation Phases

> **Historical plan, ticked off against reality on 2026-08-15.** Almost all of this shipped.
> Items marked ❌ were deliberately dropped, not forgotten — the reason is given inline.
> Remaining launch work is not in this list; it is the backend cutover tracked in
> `store/RELEASE-CHECKLIST.md` and [`apps/api/RUNBOOK.md`](../api/RUNBOOK.md).

### Phase 1: Foundation (Week 1-2)

#### Week 1: Project Setup

- [x] Install and configure additional dependencies
- [x] Set up project structure and folder organization
- [x] Create basic navigation structure with Expo Router
- [x] Implement theme system and design tokens (`lib/theme`)
- [x] Set up TypeScript configurations and type definitions

#### Week 2: Basic Map Integration

- [x] Integrate the map with Uzbekistan focus — with **Yandex MapKit**, not React Native Maps
- [x] Create mock charger data for development — used during bring-up only. ❌ Nothing mock survives in the shipped path: `lib/stations/stationsClient.ts` falls back to the last-known-good AsyncStorage cache and otherwise shows an empty map with an error state, never fabricated stations.
- [x] Implement basic marker rendering
- [x] Add user location tracking (`expo-location`)
- [x] Create custom charger pin components (`lib/markerImages.ts`)

### Phase 2: Core Features (Week 3-4)

#### Week 3: Charger Details & Navigation

- [x] Build the charger detail view — a bottom sheet (`components/stations/station-bottom-sheet.tsx`), not a modal route
- [x] Implement sheet animations and dismissal
- [ ] ❌ Distance from the user's location in the station sheet — not built. Haversine exists only in the trip planner (`lib/plan/destinations.ts`).
- [x] Integrate external navigation (`react-native-map-link` hands off to an installed maps app)
- [x] Create station information display components

#### Week 4: Vehicle Management

- [x] Build vehicle profile creation form (`app/garage/[id].tsx`)
- [x] Implement local storage for owner data (AsyncStorage via `lib/storage/jsonStorage.ts`)
- [x] Create vehicle selection and management (`app/garage/index.tsx`)
- [x] Add charger compatibility filtering (`components/stations/stations-filter-sheet.tsx`: availability, charger type, min power, connector, operator, city)
- [x] Build settings screen for preferences (Settings tab)

### Phase 3: Advanced Features (Week 5-6)

#### Week 5: Trip Planning Foundation

- [x] Waypoint input — a fixed destination list plus drop-a-pin (`app/plan/pick.tsx`). ❌ Free-text place *search* was dropped: MapKit's `lite` flavor has no geocoding or suggest.
- [x] Create basic route calculation (`GET /api/plan`)
- [x] Add battery level input and range calculation
- [x] Build trip summary display component (`app/plan/results.tsx`)
- [x] Implement trip saving functionality (`lib/plan/planHistory.ts`, on-device)

#### Week 6: Advanced Trip Planning

- [x] Develop charging stop optimization algorithm (`apps/api/src/services/planner/planner.ts`, with per-vehicle charge curves)
- [x] Integrate a routing API for road geometry — MyTaxi, called server-side and cached in `route_cache`. Drive time is modelled from distance; the provider's own ETA is deliberately not used.
- [ ] ❌ **Weather API** integration for range adjustment — never built. What shipped instead is a *user-selected* temperature derate (`temp: 'mild' | 'winter'`, 1.00 / 0.80 in `planner.ts`); nothing is fetched from a weather service.
- [x] Multiple optimization strategies — but not the planned `time | cost | convenience` switch. What shipped is a driving-style derate (`style: 'relaxed' | 'normal' | 'fast'`, 0.90 / 0.82 / 0.72) plus a Pareto set of plan `options` returned per request.
- [x] Create trip execution and navigation flow (hand-off per leg)

### Phase 4: Polish & Integration (Week 7-8)

#### Week 7: Backend Integration

- [x] Set up backend API server — Express on the always-on Android phone, embedded SQLite, in-process scrapers
- [x] Implement real charger data integration — ~1,222 canonical stations (2026-08-16, on the phone) merged from the operator APIs
- [ ] ❌ User authentication system — **not built and not planned.** The app is account-free; the only token-protected surface is `POST /ingest`.
- [x] Create data synchronization between app and backend (station fetch + status polling in `stationsClient.ts`)
- [x] Implement offline functionality (last-known-good station cache, `components/offline-banner.tsx`)

#### Week 8: Testing & Optimization

- [x] Performance optimization for map rendering
- [x] Implement marker clustering for dense areas (native `Clusterer`)
- [x] Add error handling and loading states
- [ ] Conduct user testing and gather feedback — pending public release
- [x] Bug fixes and final polish (ongoing)

## Key Algorithms & Calculations

> Sketches from the planning stage, kept for intent. The shipped planner lives server-side in
> `apps/api/src/services/planner/` and is documented in `apps/api/docs/ROUTE_PLANNER.md`. Two
> differences to be aware of before treating the pseudocode as a spec. The optimization knob is
> not `'time' | 'cost' | 'convenience'` — it is a driving-style derate (`relaxed` / `normal` /
> `fast`) and the planner returns a Pareto set of options. And range is derated only by that
> style factor plus a **user-selected** `mild` / `winter` temperature: there is **no fetched
> weather, elevation or traffic data**, because no such API is integrated.

### Charging Stop Optimization

```typescript
function optimizeChargingStops(
  route: Route,
  vehicle: VehicleProfile,
  startBattery: number,
  optimizationType: 'time' | 'cost' | 'convenience'
): ChargingStop[] {
  // Implementation of charging stop optimization algorithm
  // Consider factors:
  // - Vehicle range and efficiency
  // - Charger availability and power
  // - Route elevation and traffic
  // - User preferences and cost
}
```

### Range Calculation

```typescript
function calculateRemainingRange(
  currentBattery: number,
  vehicle: VehicleProfile,
  conditions: DrivingConditions
): number {
  const baseRange = (currentBattery / 100) * vehicle.maxRange;
  
  // Adjust for conditions
  const weatherFactor = conditions.temperature < 0 ? 0.8 : 1.0;
  const elevationFactor = calculateElevationFactor(conditions.elevation);
  const speedFactor = calculateSpeedFactor(conditions.averageSpeed);
  
  return baseRange * weatherFactor * elevationFactor * speedFactor;
}
```

## Performance Considerations

### Map Optimization Strategies

- Implement marker clustering for >50 markers
- Use debouncing for map region changes
- Cache map tiles and charger data locally
- Implement lazy loading for charger details
- Use React.memo for map components

### Data Management

- Implement efficient data fetching with pagination
- Use background sync for charger status updates
- Cache API responses with appropriate TTL
- Implement offline data storage with conflict resolution

## Security & Privacy

### Data Protection

- Owner data (garage, saved trips, preferences) stays in on-device AsyncStorage and is never uploaded, so there is no server-side user store to breach.
- **No JWT and no user authentication.** The app is account-free — there is no sign-in, no session, no password reset, and none is planned. The public read endpoints are unauthenticated by design.
- The one protected surface is `POST /ingest`. Since 2026-08-16 the API binds `127.0.0.1` by default and refuses `/ingest` (404) for any non-loopback peer or any request that arrived through the tunnel (`cf-connecting-ip`/`cf-ray`), then checks the `x-ingest-token` header; the cloudflared ingress rule (`(?i)^/ingest → 404`) is belt-and-braces. The old "loopback-only listener on 8787" idea is retired.
- Keys that must not leak are kept off the device: `MYTAXI_API_KEY` lives only in `apps/api/.env` and routing is called server-side (`EXPO_PUBLIC_MYTAXI_API_KEY` was removed from the mobile env and from EAS on 2026-08-16). Only the Yandex MapKit key ships in the app, which is what it is designed for.
- Use HTTPS for all API communications (TLS terminated at the Cloudflare edge). Android cleartext is enabled only when `EXPO_PUBLIC_API_BASE_URL` is `http://` (the `development` profile); `SYSTEM_ALERT_WINDOW` is blocked in the manifest.
- ~~Anonymize location data for analytics.~~ There are no analytics: the app ships no analytics, ads, crash-reporting or tracking SDK.
- Comply with Uzbekistan data protection laws.

### User Privacy

- Location is foreground-only ("When In Use") and used on the device; the map never uploads it. Trip planning sends the chosen start/end coordinates (possibly the current position, if "from here" was picked) and the car's figures to VoltAI's server, which forwards only the coordinates to MyTaxi — no identifier attached.
- Privacy policy: shown in-app (Settings → About) and published at <https://voltai.uz/uz/privacy>; source of truth `store/privacy-policy.html` (effective 2026-08-16).
- Data deletion = clearing the app's data or uninstalling; there is no server-side user data to delete.
- Use minimal data collection principles

## Testing Strategy

> ⏳ **NOT BUILT (2026-08-15).** There is no test runner in `apps/mobile` — no Jest, no React
> Native Testing Library, no Detox. Verification today is manual, on a device, plus
> `npm run lint` and `tsc`. The plan below is intent, not a description of a suite that exists.

### Unit Testing

- Component testing with React Native Testing Library
- Utility function testing with Jest
- State management testing
- Navigation testing

### Integration Testing

- API integration testing
- Map functionality testing
- Navigation flow testing
- Data synchronization testing

### End-to-End Testing

- User journey testing with Detox
- Cross-platform testing (iOS/Android)
- Performance testing under various conditions

## Deployment & DevOps

### Mobile App Deployment

- **Expo EAS Build** — three profiles in `eas.json`: `development` (dev client, points at `http://127.0.0.1:8080` via `adb reverse`), `preview` (internal APK) and `production` (app bundle). `preview` and `production` both point at `https://api.voltai.uz`.
- **Google Play Console** for Android distribution — the release path being prepared; see `store/RELEASE-CHECKLIST.md`.
- ⏳ **iOS / App Store Connect / TestFlight — not yet.** Only Android has a native project and store assets today.
- Expo Go is **not** supported: `expo-yandex-mapkit` ships native code, so a dev build is required.

### Backend Deployment

There is no container and no cloud host. The backend is **one always-on Android phone**:

- **Device (in service since 2026-08-16)**: ASUS Zenfone 10 (AI2302), Android 15, Termux from F-Droid
- **Runtime**: Node LTS under **Termux**, Express listening on **`127.0.0.1:8080`**
- **Supervision**: **runit** (termux-services) services `voltai-api`, `voltai-watchdog` (2-min liveness/readiness check, wake-lock, restart after 3 misses), `voltai-backup` (03:00 encrypted archive of the DB snapshot + tokens + `.env`), `sshd`, and `cloudflared` (kept down until configured); autostarted by **Termux:Boot** (`~/.termux/boot/00-voltai`), held awake with `termux-wake-lock`; Android 15 phantom-process settings applied via adb
- **Public reachability**: an outbound **Cloudflare Tunnel** (`cloudflared` dials out from the phone) serving `https://api.voltai.uz` — no inbound port, no public IP, no CGNAT problem. ⏳ **Not configured yet** (needs the DNS gate first)
- **Database**: the embedded SQLite file on the phone (`~/voltai/data/voltai.sqlite`); scrapers run in-process in the same Node process; daily `VACUUM INTO` snapshot; backup + restore drill done once
- **No Docker, no AWS/GCP/Azure, no CI/CD deploy step.** Deployment is `bash apps/api/scripts/phone/deploy.sh` from the dev box (build, tar over ssh, `npm ci --omit=dev` from the root lockfile, `sv restart`, smoke test); `.github/workflows-disabled/` is dead and scheduled for removal.
- **Monitoring**: `/api/health` (liveness, used by the watchdog), `/api/health/ready` (503 when the catalog is empty, the DB is not a real file, or the scheduler is stale — this is what an external monitor should hit), `/api/health/detail` (`build.commit`, per-source `sources.<name>.state` = `fresh|stale|never|no-login|disabled`, `auth.<name>.daysLeft`). ⏳ The external uptime check itself is not set up yet.

Why it is built this way: [`/ARCHITECTURE.md`](../../ARCHITECTURE.md).
Step-by-step deployment and operations: [`apps/api/RUNBOOK.md`](../api/RUNBOOK.md).

⏳ **Not yet done (2026-08-16):** the cutover itself. `voltai.uz` nameservers are still
`rdns1/2/3.ahost.uz`, and `api.voltai.uz` is still a CNAME to Vercel returning HTTP 500; the
tunnel token is not configured; no rclone remote for off-phone backup copies; the server phone
still has a lock-screen PIN (so an unattended reboot only recovers after the first unlock). See
`apps/api/docs/GATES.md` §Gate 2 and `apps/api/RUNBOOK.md`.

### Website Deployment

The marketing site (`apps/web`, `voltai.uz`) **is** on Vercel. That is the only part of VoltAI
that is, and it is correct — do not generalise it to the API.

## Monitoring & Analytics

> ⏳ **NOT BUILT (2026-08-15).** No analytics or crash-reporting SDK is installed in
> `apps/mobile` — no Google Analytics, no Sentry. The only monitoring that exists is on the
> backend side: `/api/health` and `/api/health/detail`. Everything below is intent.

### Key Metrics to Track

- User engagement (DAU, session duration)
- Feature usage (trip plans created, stations saved)
- Performance metrics (app load time, map render time)
- Error rates and crash analytics
- Charger data accuracy and update frequency

### Analytics Implementation

- **Google Analytics** or similar for user behavior
- **Custom events** for feature usage tracking
- **Performance monitoring** for app responsiveness
- **Error tracking** with Sentry or similar

## Future Scalability

### Technical Scalability

The origin is a single phone, so the scaling path is "keep traffic off the origin", not
"split the origin into services". Microservices are not the plan.

- **Cloudflare edge Cache Rule on `/api/stations*`, `/api/stations/statuses` and `/api/plan*` — mandatory, not an optimization** (`/ARCHITECTURE.md` §2). Extensionless `application/json` responses are treated as dynamic by default, so without an explicit "Eligible for cache" rule every client poll reaches the phone. Verify with `cf-cache-status: HIT`.
- The origin already emits its own `Cache-Control` + `ETag` so the edge can revalidate cheaply — but that alone does not make the response cacheable; the rule is what does.
- **Deferred: a read-only cloud replica** behind a Cloudflare Load Balancer, fed by `POST /ingest`, for when one phone is no longer enough (`/ARCHITECTURE.md` §6). ⏳ Not built.
- **Single point of failure** is the real risk, not throughput: one phone. Mitigated by runit + the local watchdog, the nightly encrypted backup with a proven restore, `GET /api/client-config` as a maintenance/forced-update channel to installed apps, an external uptime check (⏳ not yet set up), and eventually the replica above.
- The API also protects itself: `/api/plan` has a per-IP limiter (429) and an inflight cap (503 + `Retry-After`), route geometry is cached for 90 days, and `/api/stations` pages are capped at 1000 rows with hashed ETags.
- CDN for static assets and map tiles (map tiles are Yandex's own CDN).

### Feature Scalability

- Plugin architecture for additional services
- Internationalization framework for multiple languages
- Modular component system for easy feature additions
- API versioning for backward compatibility

This technical architecture provides a solid foundation for building a scalable, performant EV charger application that meets all specified requirements while maintaining code quality and developer productivity.
