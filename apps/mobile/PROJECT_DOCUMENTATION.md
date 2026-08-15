# VoltAI - EV Charger Application Documentation

> **Document status (updated 2026-08-16).** This started life as the pre-build planning
> document. The stack questions it left open ("to be determined") have all been decided and
> shipped; the sections below have been corrected to describe what actually exists. The
> phased plan and the week-by-week timeline near the end are kept as **historical planning
> record** and are labelled as such.
>
> The backend is **not** a cloud service: the Express API, the operator scrapers and the
> database all run together on one always-on Android phone, to be exposed at
> `https://api.voltai.uz` through an outbound Cloudflare Tunnel. As of 2026-08-16 it is
> **deployed and supervised on that phone** (~1,222 stations, backup drill done), but the public
> hostname is **not cut over yet** — DNS Gate 2 and the tunnel are still owner actions, so the API
> answers only on the phone (`127.0.0.1:8080`) or over `adb forward`. Why:
> [`/ARCHITECTURE.md`](../../ARCHITECTURE.md). How to deploy it:
> [`apps/api/RUNBOOK.md`](../api/RUNBOOK.md).

## Project Overview

VoltAI is a comprehensive electric vehicle charging station application designed specifically for Uzbekistan. The app provides real-time information about EV charging stations, trip planning capabilities, and personalized charging recommendations.

## Technology Stack

- **Framework**: React Native with Expo
- **Language**: TypeScript
- **Routing**: Expo Router (file-based routing)
- **Navigation**: React Navigation
- **State Management**: jotai atoms (`lib/vehicles/garage-atoms.ts`, `lib/plan/plan-history-atoms.ts`) with explicit hydration from AsyncStorage. Shipped — no Zustand and no Redux are used; there is no `zustand` dependency in `package.json`.
- **Maps**: Yandex MapKit via `expo-yandex-mapkit` (flavor: lite). Shipped — it ships native code, so a dev build is required and Expo Go is not supported.
- **Backend**: Node.js/Express with an embedded SQLite database (node-sqlite3-wasm), self-hosted on an always-on Android phone under Termux and exposed at `https://api.voltai.uz` via a Cloudflare Tunnel. Decided and built — see [`/ARCHITECTURE.md`](../../ARCHITECTURE.md) and [`apps/api/RUNBOOK.md`](../api/RUNBOOK.md).
- **Accounts**: none. The app is account-free — there is no sign-in, no user record and no server-side user data.

## Core Features

> This was the original wish list. Most of it shipped; the items that were **not** built are
> marked *(not built)* inline so the list stops reading as a description of the app.

### 1. Map View with Charger Locations

- Display all EV chargers in Uzbekistan on an interactive map
- Custom charger pin icons with different colors/types
- Real-time charger status (available, in-use, offline)
- Cluster markers for dense areas

### 2. Charger Detail Sheet

Shipped as a bottom sheet, not a modal route.

- Tap marker to open detailed charger information
- Station name, power output (kW), connector types
- Photos of the charging station *(not built — not shown in the sheet)*
- Complete address and coordinates
- Contact information and operating hours *(neither is built — no contact field is scraped, and the API's `working_hours` column is not carried into the app or shown in the sheet)*
- Operator details and pricing information
- User ratings and reviews *(not built — there is no rating or review feature; the canonical row's scraped `rating` column is never carried into the app)*

### 3. User Location & Navigation

- Display user's current location on map
- Calculate distance from user to each charger *(not built — distance is only used inside the trip planner)*
- Integrated navigation (hand off to an installed maps app via `react-native-map-link`)
- Route optimization — computed server-side by `GET /api/plan`. No traffic API is integrated, so ETAs carry no live-traffic term.

### 4. Vehicle Profile Management

- Save car model and specifications
- Store battery capacity (kWh) *(not stored — the garage takes real range plus consumption (Wh/km) and derives pack size from them, `lib/vehicles/garage.ts`)*
- Configure vehicle range
- Multiple vehicle profiles support
- Charging speed compatibility checking

### 5. Advanced Trip Planner

- Set start and end points for journeys
- Input starting battery level/range
- Algorithm suggests optimal charging stops along route
- Calculate total trip time including charging stops
- Show alternative plans (the planner returns a Pareto set of options)
- Range estimation derated by driving style (`relaxed`/`normal`/`fast`) and a user-selected `mild`/`winter` temperature — no live conditions are fetched

### 6. Personalization Features

- Save favorite charging stations *(not built)*
- Save frequently used routes — shipped as saved trips in on-device AsyncStorage
- Charging history and statistics *(not built)*
- Notifications for saved stations (availability, maintenance) *(not built — no push notifications)*

## Technical Implementation Plan (historical — Phases 1-3 shipped)

> Kept as the original planning record. Phases 1-3 are built: the Yandex map, the charger
> detail sheet, navigation hand-off, the garage (vehicle profiles) and the trip planner all
> ship today. Phase 4 is partly done — marker clustering and the offline station cache exist;
> **push notifications and the user rating/review system were never built** (there is no
> `expo-notifications` dependency and no reviews endpoint).

### Phase 1: Foundation & Map Integration

1. **Set up map component** with Uzbekistan focus
2. **Integrate charging station data source** (API/database)
3. **Implement custom marker system** for chargers
4. **Add user location tracking**

### Phase 2: Core Features

1. **Build charger detail modal** with comprehensive information
2. **Implement navigation integration**
3. **Create vehicle profile management**
4. **Add distance calculation** and real-time updates

### Phase 3: Advanced Features

1. **Develop trip planning algorithm**
2. **Implement route optimization**
3. **Add charging time calculations**
4. **Create personalization features**

### Phase 4: Polish & Optimization

1. **Performance optimization** for map rendering
2. **Offline functionality** for saved data
3. **Push notifications** for charger status
4. **User feedback and rating system**

## Data Requirements

> The two interfaces below are the original sketch, not the shipped types. The real shapes are:
> the server-side canonical row in `apps/api/src/db/schema.ts` (SQLite `stations` table), the
> client type in `apps/mobile/lib/stations/stationsClient.ts`, and the saved-car type in
> `apps/mobile/lib/vehicles/garage.ts` (which carries a charge curve, plug set and range source
> the sketch never had). The canonical row carries name, address, lat/lng, connectors,
> working hours, rating, description, images, sources and primary source — there are no
> `reviews` and no `amenities` columns, and user ratings/reviews were never built.

### Charging Station Data Structure

```typescript
interface ChargingStation {
  id: string;
  name: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  operator: string;
  powerOutput: number; // kW
  connectorTypes: string[];
  status: 'available' | 'in-use' | 'offline';
  address: string;
  contact: {
    phone?: string;
    email?: string;
  };
  photos: string[];
  pricing: {
    perKwh?: number;
    perMinute?: number;
    parkingFee?: number;
  };
  amenities: string[];
  operatingHours: string;
}
```

### Vehicle Profile Structure

```typescript
interface VehicleProfile {
  id: string;
  model: string;
  batteryCapacity: number; // kWh
  maxRange: number; // km
  chargingSpeed: {
    ac: number; // kW
    dc: number; // kW
  };
  connectorTypes: string[];
}
```

## User Interface Flow

### Main Tabs Structure

Three tabs shipped, not four (`app/(tabs)/_layout.tsx`):

1. **Map** (`index`): primary map view with charger locations
2. **Route** (`route`): trip planning and optimization; saved trips live under `app/plan/history`
3. **Settings** (`explore`): preferences, and the entry point to the garage (`app/garage`)

There is no separate Favorites tab and no Profile tab — with no accounts, "profile" is just the
garage, reached from Settings.

### Navigation Flow

```
Map → Tap Charger → Detail Sheet → Navigate (hand off to a maps app)
Route → Set Start/End + Battery → View Charging Stops → Save Trip
Settings → Garage → Manage Vehicles / Set Preferences
```

## API Integration Requirements

### External APIs actually used

1. **Maps Provider**: Yandex MapKit — map rendering, markers and clustering, in the mobile app. Client-side key (`YANDEX_MAPKIT_API_KEY`, see `.env.example`).
2. ~~**Geocoding Service**~~ — never integrated. MapKit's `lite` flavor has no geocoding or suggest (full-flavor only), so trip endpoints come from a fixed destination list (`lib/plan/destinations.ts`) plus drop-a-pin on the map (`app/plan/pick.tsx`).
3. **Routing Service**: MyTaxi (`https://proxy.mytaxi.uz/v1`), called **server-side only** from `apps/api` (`src/services/routing/mytaxi.ts`). `MYTAXI_API_KEY` lives in `apps/api/.env` and deliberately never ships in the mobile bundle.
4. **Charging Station Data**: VoltAI's own API — the operators' own APIs are scraped in-process on the backend phone and merged into a canonical SQLite `stations` table. **Not** Open Charge Map.
5. ~~**Weather API**~~ — never integrated. Cold-weather range loss is a *user-selected* `mild`/`winter` derate in the plan request, not a fetched forecast.

### Custom API Endpoints (Backend)

- `/api/stations` - Get charging stations
- `/api/stations/:id` - Get station details
- `/api/stations/statuses` - Compact near-real-time status feed
- `/api/stations/nearby` - Stations near a coordinate
- `/api/stations/search` - Full-text station search
- `/api/plan` - Generate trip plans (**not** `/api/routes/plan`); answers 400 for bad params or
  endpoints outside the Central-Asia service area, 429 when a client plans too often, 503 when
  the phone is busy, and `geometry: "estimated"` (straight-line) when routing is unavailable
- `/api/client-config` - Read at launch (fail-open): maintenance banner, one-time message,
  forced-update threshold
- `/api/health`, `/api/health/ready`, `/api/health/detail` - Liveness, readiness (503 when the
  catalog is empty or the scraper is stale) and data-freshness detail

There are **no `/api/user/*` endpoints.** The app is account-free: vehicle profiles (garage)
and saved trips live in on-device AsyncStorage and are never sent to the server. The only
non-public route is `POST /ingest`, which the API refuses unless the request comes from the
phone's own loopback interface (and never through the tunnel), on top of a shared-secret token.

## Performance Considerations

> Original intent list; as shipped (2026-08-16): native marker clustering; the whole catalog is
> fetched in 1000-row pages with ETags and cached in AsyncStorage as last-known-good; connector
> statuses are polled from `/api/stations/statuses` **only while the app is in the foreground**
> (there is no background fetch/task — the "Live" pill shows the backend-reported data age
> instead); the catalog load does not wait for GPS and refetches when connectivity or the
> foreground returns; location is foreground-only ("When In Use").

- **Map Optimization**: Implement marker clustering for large datasets
- **Data Caching**: Cache station data and user preferences locally
- **Lazy Loading**: Load charger details only when needed
- **Background Updates**: Update charger status in background *(not built — foreground polling only)*
- **Battery Optimization**: Efficient location tracking

## Security & Privacy

- **Location Privacy**: foreground-only ("When In Use") permission, used on the device to centre the map. The map never sends the device location to the VoltAI API. The **one exception is trip planning**: when the user asks for a route, the chosen start and end coordinates (which may be the current position if "from here" was picked) and the car's figures are sent to VoltAI's server, which forwards only the coordinates to the MyTaxi routing provider — with no name, account or device identifier. This is what the published privacy policy says (in-app Settings → About, <https://voltai.uz/uz/privacy>, `store/privacy-policy.html`).
- **Data Storage**: user preferences, the garage and saved trips stay in on-device AsyncStorage; nothing is synced to a server, so there is no server-side user data to protect. No analytics, ads or crash-reporting SDKs.
- **API Security**: the public read endpoints are unauthenticated by design — there are no user accounts and no sign-in. The only protected surface is `POST /ingest`: the API binds `127.0.0.1` and refuses `/ingest` for any non-loopback peer or any request that arrived through the tunnel, then checks the `x-ingest-token` header.
- **Transport**: HTTPS everywhere once the tunnel is up (TLS terminated at the Cloudflare edge). Android cleartext is only enabled in builds whose `EXPO_PUBLIC_API_BASE_URL` is `http://` (the `development` profile talking to `127.0.0.1:8080`).
- **Compliance**: Adhere to Uzbekistan data protection regulations

## Future Enhancements

1. **Multi-language Support**: Uzbek, Russian, English
2. **Payment Integration**: In-app charging payments
3. **Social Features**: User reviews and photos
4. **Advanced Analytics**: Charging patterns and cost analysis
5. **Integration with Car APIs**: Direct vehicle data access
6. **AR Features**: Augmented reality navigation to chargers

## Development Timeline (historical — the original 8-week estimate)

> Kept for the record only. The app was built and the schedule below is not how it played out;
> do not read it as remaining work. The backend is deployed on the phone (2026-08-16); what is
> left before public release is the cutover of `api.voltai.uz` (Cloudflare DNS + tunnel) and the
> store items tracked in `store/RELEASE-CHECKLIST.md` and `apps/api/RUNBOOK.md`.

### Week 1-2: Setup & Basic Map

- Project structure and dependencies
- Basic map integration with Uzbekistan focus
- Mock data implementation

### Week 3-4: Core Features

- Charger detail modal
- User location integration
- Basic navigation

### Week 5-6: Trip Planning

- Route calculation algorithms
- Charging stop optimization
- Vehicle profile integration

### Week 7-8: Polish & Testing

- UI/UX refinement
- Performance optimization
- User testing and feedback

## Success Metrics

- **User Engagement**: Daily active users, session duration
- **Feature Usage**: Trip plans created, stations saved
- **Technical Performance**: App load time, map rendering speed
- **User Satisfaction**: App store ratings, user feedback

This documentation provides a comprehensive roadmap for developing VoltAI, ensuring all requested features are properly planned and organized for successful implementation.
