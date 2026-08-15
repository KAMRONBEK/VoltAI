# VoltAI - Feature Specifications & User Flows

> **Document status (updated 2026-08-16).** Written before the app was built. The features
> below shipped, but several of the TypeScript shapes here are wishlist rather than reality —
> where a field was never sourced or a sub-feature was dropped, it is now called out inline.
> The "External APIs Required" list at the end has been corrected to what is actually consumed.
>
> Two facts that change how the rest reads: the app is **account-free** (no sign-in; the garage,
> saved trips and preferences never leave the device — except that a trip request carries the
> chosen start/end coordinates and the car's figures to the server), and the station data comes
> from **VoltAI's own API**, which runs on an always-on Android phone (deployed there since
> 2026-08-16; the public `api.voltai.uz` hostname is not cut over yet) — see
> [`/ARCHITECTURE.md`](../../ARCHITECTURE.md) and [`apps/api/RUNBOOK.md`](../api/RUNBOOK.md).

## Feature 1: Map with Charger Locations

### User Stories

- **As a user**, I want to see all EV chargers in Uzbekistan on a map so I can find charging stations near me
- **As a user**, I want to see different charger types with custom icons so I can quickly identify compatible stations
- **As a user**, I want to see real-time charger status so I know which stations are available

### Technical Specifications

```typescript
interface MapFeature {
  // Map Configuration
  initialRegion: {
    latitude: 41.2995, // Uzbekistan center
    longitude: 69.2401,
    latitudeDelta: 4.0,
    longitudeDelta: 4.0
  };
  
  // Charger Markers
  markers: ChargerMarker[];
  clusterEnabled: boolean;
  clusterRadius: number;
  
  // User Location
  showUserLocation: boolean;
  trackUserLocation: boolean;
}

interface ChargerMarker {
  id: string;
  coordinate: {
    latitude: number;
    longitude: number;
  };
  type: 'fast' | 'standard' | 'tesla' | 'ac' | 'dc';
  status: 'available' | 'in-use' | 'offline' | 'unknown';
  power: number; // kW
  operator: string;
}
```

### User Flow

1. **App Launch** → Map loads with Uzbekistan view (Yandex MapKit); `GET /api/client-config` is read fail-open (maintenance banner / one-time message / forced-update modal)
2. **Location Permission** → Request foreground ("When In Use") location access; declining it never blocks the map
3. **Data Loading** → Fetch the catalog from `GET /api/stations` in 1000-row pages (de-duplicated by id), **independently of GPS**; on failure show the last-known-good AsyncStorage cache with a truthful error/offline state and retry automatically when connectivity returns (NetInfo) or the app comes back to the foreground
4. **Marker Rendering** → Display custom icons based on charger type, with the native `Clusterer` handling density
5. **Status Polling** → `GET /api/stations/statuses` refreshes availability without refetching the catalog, only while the app is in the foreground; the **Live** pill reflects the backend-reported data age (`lastMergeAt` / `stale`), and statuses the backend considers older than 1 h arrive as `unknown`
6. **User Interaction** → Tap marker to open the detail bottom sheet

## Feature 2: Charger Detail Sheet

> Shipped as a `@gorhom/bottom-sheet` (`components/stations/station-bottom-sheet.tsx`), not a
> modal route. Fields in the shape below that were never sourced from the operator APIs and are
> **not** displayed: `distance`, `photos`, `contact`, `amenities`, `operatingHours`,
> `userRating`. (`working_hours` and `rating` do exist as columns on the canonical `stations`
> row, but neither is carried into the mobile client.) There are no reviews in VoltAI.

### User Stories

- **As a user**, I want to see detailed charger information when I tap a marker
- **As a user**, I want to see distance from my current location
- **As a user**, I want to navigate to the charger with one tap
- **As a user**, I want to see photos and contact information

### Technical Specifications

```typescript
interface ChargerDetailModal {
  station: {
    name: string;
    address: string;
    coordinates: Coordinate;
    distance: number; // meters from user
    power: number; // kW
    connectorTypes: string[];
    photos: string[];
    contact: {
      phone?: string;
      email?: string;
      website?: string;
    };
    operator: string;
    pricing: PricingInfo;
    amenities: string[];
    operatingHours: string;
    userRating: number;
  };
  
  // Actions
  actions: {
    navigate: () => void;
    save: () => void;
    call: () => void;
    share: () => void;
  };
}
```

### User Flow

1. **Marker Tap** → Open the detail sheet with a slide-up animation
2. **Content Display** → Show station name, address, operator, connectors and live status
3. **Action Selection** → Navigate (hand off to an installed maps app — Yandex Navigator, Yandex Maps, 2GIS, Waze or Google Maps, declared in the manifest `<queries>` / `LSApplicationQueriesSchemes`; falls back to a `geo:` intent / Apple Maps). ⏳ Save / call / share were never built — there is no favourites feature anywhere in the app.
4. **Sheet Close** → Swipe down or tap outside to close

## Feature 3: Vehicle Profile Management ("the garage")

> Shipped, device-local, no account. The real type is `SavedCar` in `lib/vehicles/garage.ts` and
> it is deliberately narrower and more opinionated than the sketch below: `label`, `rangeKm` +
> `rangeSource` (sticker figures are scaled by 0.72), a **nullable `plug`** that blocks planning
> until answered (Uzbekistan's DC network is overwhelmingly GB/T, so a guessed plug routes you to
> sockets that physically do not fit), `dcPeakKw`, `consWhKm` and a `curvePreset` instead of a
> raw `chargingCurve` array. No `manufacturer`/`year`, and no live `batteryLevel` on the car —
> state of charge is entered per trip.

### User Stories

- **As a user**, I want to save my car model and specifications
- **As a user**, I want to set my battery size and range
- **As a user**, I want to manage multiple vehicle profiles

### Technical Specifications

```typescript
interface VehicleProfile {
  id: string;
  name: string;
  model: string;
  manufacturer: string;
  year: number;
  
  // Battery & Range
  batteryCapacity: number; // kWh
  maxRange: number; // km at 100% charge
  efficiency: number; // Wh/km
  
  // Charging Specifications
  charging: {
    acMaxPower: number; // kW
    dcMaxPower: number; // kW
    connectorTypes: string[];
    chargingCurve: number[]; // charging speed at different SOC
  };
  
  // Current State
  currentRange?: number;
  batteryLevel?: number; // 0-100%
}
```

### User Flow

1. **Profile Setup** → User enters vehicle details on first launch
2. **Multiple Vehicles** → Switch between saved vehicle profiles
3. **Range Updates** → Update current range based on usage
4. **Compatibility Check** → Filter chargers by vehicle compatibility

## Feature 4: Trip Planner

> Shipped. The plan is computed server-side by `GET /api/plan` (`apps/api/src/services/planner/`,
> documented in `apps/api/docs/ROUTE_PLANNER.md`) and the client contract lives in
> `lib/plan/planClient.ts`. Differences from the sketch below: the optimization knob is
> `style: 'relaxed' | 'normal' | 'fast'` plus `temp: 'mild' | 'winter'`, not
> `'time' | 'cost' | 'convenience'`, and the response returns a Pareto set of `options` rather
> than one plan. ⏳ Per-stop monetary **cost** is not computed anywhere in the planner.
>
> What leaves the device: the request carries the chosen start/end coordinates (which may be the
> current position if "from here" was picked) and the selected car's figures (range, plug,
> peak DC kW, consumption, curve preset, starting SoC, style, temperature) — no identifier. The
> server forwards only the two coordinates to MyTaxi for road geometry. The API answers 400 for
> out-of-bounds params or endpoints outside the Central-Asia service area, 429 when a client
> plans too often, 503 (`Retry-After`) when the phone is busy, and marks the response
> `geometry: "estimated"` / `geometryTrusted: false` when routing is unavailable — the app
> labels such plans as estimated. Garage range figures are validated before a plan is requested.

### User Stories

- **As a user**, I want to plan trips with start and end points
- **As a user**, I want to input my starting battery level
- **As a user**, I want to see optimal charging stops along my route
- **As a user**, I want to see total trip time including charging

### Technical Specifications

```typescript
interface TripPlan {
  id: string;
  startPoint: Coordinate;
  endPoint: Coordinate;
  waypoints: Waypoint[];
  
  // Vehicle State
  vehicle: VehicleProfile;
  startBatteryLevel: number; // 0-100%
  startRange: number; // km
  
  // Route Information
  totalDistance: number; // km
  estimatedDuration: number; // minutes
  chargingStops: ChargingStop[];
  
  // Optimization
  optimizationType: 'time' | 'cost' | 'convenience';
}

interface ChargingStop {
  station: ChargingStation;
  arrivalBattery: number; // %
  chargeTime: number; // minutes
  chargeAmount: number; // kWh
  cost: number;
}
```

### User Flow

1. **Trip Setup** → User enters start/end points and battery level
2. **Route Calculation** → Generate route with charging stops
3. **Optimization** → Adjust based on time/cost preferences
4. **Execution** → Start navigation with charging stop reminders

## Feature 5: Personalization & Saved Data

> Partly shipped. **Saved trips** exist (`lib/plan/planHistory.ts`, `app/plan/history.tsx`), all
> on-device. ⏳ **Favourite stations and notifications were never built** — there is no favourites
> code anywhere in the app and no `expo-notifications` dependency. The shipped settings type is
> `AppSettings` in `lib/settings/appSettings.ts` and today it holds exactly one field,
> `themePreference`; the richer `UserPreferences` below is intent, not reality.

### User Stories

- **As a user**, I want to save my favorite charging stations *(not built)*
- **As a user**, I want to save frequently used routes *(shipped)*
- **As a user**, I want to receive notifications for saved stations *(not built)*

### Technical Specifications

```typescript
interface UserPreferences {
  // Saved Items
  favoriteStations: string[]; // station IDs
  savedRoutes: string[]; // route IDs
  
  // Notifications
  notifications: {
    stationAvailability: boolean;
    priceChanges: boolean;
    newStations: boolean;
    maintenanceAlerts: boolean;
  };
  
  // Display Preferences
  mapType: 'standard' | 'satellite' | 'hybrid';
  distanceUnit: 'km' | 'miles';
  language: 'uz' | 'ru' | 'en';
  
  // Charging Preferences
  preferredOperators: string[];
  minPower: number; // kW
  avoidTollRoads: boolean;
}
```

### User Flow

1. ⏳ **Station Saving** → not built
2. **Route Saving** → Save trip plan after creation
3. ⏳ **Notification Setup** → not built
4. **Quick Access** → Saved trips from the Route tab; vehicles from Settings → Garage. There is no Favorites tab.

## Data Models Summary

### Core Data Structures

> Sketch only. The authoritative shapes are `apps/api/src/db/schema.ts` (canonical SQLite
> `stations` row) and `apps/mobile/lib/stations/stationsClient.ts` (client type). Differences
> that matter: there is **no `UserData`** — the app is account-free, so there is no user record,
> no charging history and no server-side trip history; `reviews` and `amenities` do not exist;
> and `TripData` carries **no `weather` and no `traffic`** objects, because neither API is
> integrated — the only environmental input is the user-chosen `mild` / `winter` derate.

```typescript
// Charging Station
interface ChargingStation {
  id: string;
  name: string;
  location: Coordinate;
  operator: Operator;
  connectors: Connector[];
  status: StationStatus;
  amenities: Amenity[];
  pricing: Pricing;
  photos: string[];
  reviews: Review[];
}

// User Data
interface UserData {
  vehicles: VehicleProfile[];
  preferences: UserPreferences;
  tripHistory: TripHistory[];
  chargingHistory: ChargingSession[];
}

// Trip Data
interface TripData {
  route: Route;
  vehicle: VehicleProfile;
  chargingStops: ChargingStop[];
  weather: WeatherData;
  traffic: TrafficData;
}
```

## Integration Points

### External APIs actually used

1. **Yandex MapKit** — map rendering, markers and clustering, called from the mobile app. Client-side key (`YANDEX_MAPKIT_API_KEY` / `EXPO_PUBLIC_YANDEX_MAPKIT_API_KEY`, see `.env.example`). Flavor `lite`, which is why there is no geocoding or place-suggest.
2. **VoltAI's own API** (`https://api.voltai.uz`) — stations, live statuses, trip plans and client config. This is not a third party: it is the Express service on the always-on Android phone, which scrapes the operators' own APIs in-process and merges them (~1,222 canonical stations, 2026-08-16). **There is no third-party "Charging Station API".** ⏳ The public hostname is not cut over yet (DNS Gate 2 + tunnel); until then only the phone itself / `adb reverse` reaches it, at `http://127.0.0.1:8080` (`EXPO_PUBLIC_API_BASE_URL`).
3. **MyTaxi routing** (`https://proxy.mytaxi.uz/v1`) — road geometry for trip planning, called **server-side only** from `apps/api` (`src/services/routing/mytaxi.ts`). `MYTAXI_API_KEY` lives in `apps/api/.env` and deliberately never ships in the mobile bundle: an `EXPO_PUBLIC_` key is extractable from any shipped build, and rotating it would break every installed copy at once. Results are cached in the `route_cache` table.
4. ~~**Weather API**~~ — not integrated. Cold-weather range loss is handled by a *user-selected* `mild` / `winter` derate in the plan request, not by fetching a forecast.
5. ~~**Traffic API**~~ — not integrated. Drive time is modelled from distance; there is no live-traffic term (the routing provider's own ETA is deliberately discarded as unreliable).

Navigation itself is a hand-off: `react-native-map-link` opens whichever maps app the user has
installed. VoltAI does not implement turn-by-turn.

### Local Storage

Everything the user configures is device-local (AsyncStorage via `lib/storage/jsonStorage.ts`)
and is never sent to the server — the app is account-free:

- Vehicle profiles (the garage)
- Saved trips
- App preferences (`themePreference`)
- Offline charger data (last-known-good station cache)

This specification provides detailed technical requirements and user flows for implementing all requested features in the VoltAI application.
