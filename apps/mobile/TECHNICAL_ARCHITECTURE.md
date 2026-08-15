# VoltAI - Technical Architecture & Implementation Plan

> **Document status (updated 2026-08-15).** This was written before the system was built and
> planned a PostgreSQL + Redis + Docker/AWS backend with JWT user accounts. None of that was
> built, and none of it is the plan. The sections below have been corrected to the shipped
> architecture; the week-by-week implementation phases are kept as historical record and
> labelled as such.
>
> Authoritative companions: **why** the architecture is what it is —
> [`/ARCHITECTURE.md`](../../ARCHITECTURE.md); **how** the backend is deployed and operated —
> [`apps/api/RUNBOOK.md`](../api/RUNBOOK.md).

## System Architecture Overview

```
┌──────────────────────┐        ┌───────────────────────────┐
│      Mobile App      │  HTTPS │     Cloudflare edge       │
│  Expo / React Native │───────▶│  TLS termination + cache  │
│    Yandex MapKit     │        │  (Cache Rule on /api/*)   │
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
  only third party the app itself calls.

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
├── app.ts                # Express app: routes, CORS, error handler
├── index.ts              # Listener + the randomized scrape/merge loop
├── routes/               # /api/stations, /api/plan, /ingest
├── services/             # Merge, route planning, MyTaxi routing
├── repositories/         # Data access over SQLite
├── db/                   # sqlite.ts (connection) + schema.ts (DDL) + mappers
├── config/               # Configuration
└── utils/                # Utilities
scrapers/http/            # Operator API scrapers, called in-process
scripts/termux/           # Phone bootstrap + runit services
scripts/cloudflared/      # Tunnel ingress config
```

There is no `middleware/auth` — there is no user authentication to do (see Security & Privacy).

⏳ **Outstanding cleanup (2026-08-15):** `src/models/`, `src/config/database.ts`,
`scrapers/appium/`, `scrapers/run-app-scraper.ts`, `apps/api/api/index.ts` and
`apps/api/vercel.json` are leftovers from the retired MongoDB/Vercel/emulator design and are
still tracked in git. Their deletion is listed in `/ARCHITECTURE.md` §7 but has **not** happened.

### Database Schema

The PostgreSQL DDL that used to sit here was never built and PostgreSQL is not part of this
system. **The real schema is `apps/api/src/db/schema.ts`** — SQLite, held in one embedded file
via `node-sqlite3-wasm`, and it is the single source of truth. Shape, in summary:

| Table | What it holds |
| --- | --- |
| `raw_stations` | One row per operator record, as scraped. Unique on `(source, external_id)`; never pruned. |
| `stations` | The canonical, merged catalog the API serves. |
| `meta` | Housekeeping stamps such as `lastScrapeAt` / `lastMergeAt`, surfaced by `/api/health/detail`. |
| `stations_fts` | External-content FTS5 index over `stations(name, address)`, rebuilt after each merge; backs `/api/stations/search`. |
| `route_cache` | Road geometry from the routing provider, keyed by origin/destination quantized to 3 dp. Long-lived on purpose — a repeated trip costs zero routing calls. |

Details worth knowing before touching it:

- **`lat` and `lng` are separate indexed `REAL` columns**, not a geometry type. The nearby query
  needs indexable scalars for its bounding-box prefilter; GeoJSON `[lng, lat]` is reassembled at
  the serialization boundary.
- **`stations._id` is a 24-hex content hash**, kept ObjectId-shaped so the mobile offline cache
  keys stay stable (`src/repositories/objectId.ts`).
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
- [x] Implement real charger data integration — ~1,226 canonical stations merged from the operator APIs
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
- The one protected surface is `POST /ingest`, gated by the `x-ingest-token` header and 404'd at the Cloudflare Tunnel ingress (`path: ^/ingest`). Note the token is the real defence: the ingress rule is a case-sensitive regex while Express routing is not, and there is no separate loopback listener — `/ARCHITECTURE.md` §3 records the loopback-only listener on 8787 as recommended hardening that is **not built**.
- Keys that must not leak are kept off the device: `MYTAXI_API_KEY` lives only in `apps/api/.env` and routing is called server-side. Only the Yandex MapKit key ships in the app, which is what it is designed for.
- Use HTTPS for all API communications (TLS terminated at the Cloudflare edge).
- Anonymize location data for analytics.
- Comply with Uzbekistan data protection laws.

### User Privacy

- Request explicit consent for location tracking
- Provide clear privacy policy and data usage explanation
- Implement data deletion functionality
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

- **Runtime**: Node LTS under **Termux**, Express listening on port **8080**
- **Supervision**: **runit** (termux-services) via `apps/api/scripts/termux/install-services.sh`, autostarted by **Termux:Boot**, held awake with `termux-wake-lock`
- **Public reachability**: an outbound **Cloudflare Tunnel** (`cloudflared` dials out from the phone) serving `https://api.voltai.uz` — no inbound port, no public IP, no CGNAT problem
- **Database**: the embedded SQLite file on the phone; scrapers run in-process in the same Node process
- **No Docker, no AWS/GCP/Azure, no CI/CD deploy step.** Deployment is `dist/` + `.env` on the device; `.github/workflows-disabled/` is dead and scheduled for removal.
- **Monitoring**: an external uptime check against `/api/health`, plus a staleness alarm on `/api/health/detail` (`stale`, `secondsSinceLastScrape`, and the per-source `lastIngestAt` values — `stale` alone only catches a stopped scheduler, not dead sources)

Why it is built this way: [`/ARCHITECTURE.md`](../../ARCHITECTURE.md).
Step-by-step deployment and operations: [`apps/api/RUNBOOK.md`](../api/RUNBOOK.md).

⏳ **Not yet done (2026-08-15):** the cutover itself. `voltai.uz` nameservers are still
`rdns1/2/3.ahost.uz`, and `api.voltai.uz` is still a CNAME to Vercel returning HTTP 500. See
`apps/api/docs/GATES.md` §Gate 2.

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
- **Single point of failure** is the real risk, not throughput: one phone. Mitigated by the local watchdog, an external uptime check, and eventually the replica above.
- CDN for static assets and map tiles (map tiles are Yandex's own CDN).

### Feature Scalability

- Plugin architecture for additional services
- Internationalization framework for multiple languages
- Modular component system for easy feature additions
- API versioning for backward compatibility

This technical architecture provides a solid foundation for building a scalable, performant EV charger application that meets all specified requirements while maintaining code quality and developer productivity.
