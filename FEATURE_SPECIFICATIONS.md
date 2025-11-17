# VoltAI - Feature Specifications & User Flows

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

1. **App Launch** → Map loads with Uzbekistan view
2. **Location Permission** → Request user location access
3. **Data Loading** → Fetch charger data from API
4. **Marker Rendering** → Display custom icons based on charger type
5. **User Interaction** → Tap marker for details

## Feature 2: Charger Detail Modal

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

1. **Marker Tap** → Open detail modal with slide-up animation
2. **Content Display** → Show station info, photos, contact details
3. **Action Selection** → User chooses navigate, save, or call
4. **Modal Close** → Swipe down or tap outside to close

## Feature 3: Vehicle Profile Management

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

### User Stories

- **As a user**, I want to save my favorite charging stations
- **As a user**, I want to save frequently used routes
- **As a user**, I want to receive notifications for saved stations

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

1. **Station Saving** → Tap save icon on charger detail
2. **Route Saving** → Save trip plan after creation
3. **Notification Setup** → Configure alerts in settings
4. **Quick Access** → Access saved items from favorites tab

## Data Models Summary

### Core Data Structures

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

### External APIs Required

1. **Maps API** - Display and navigation
2. **Charging Station API** - Real-time data
3. **Routing API** - Trip planning
4. **Weather API** - Range adjustment
5. **Traffic API** - ETA calculations

### Local Storage

- Vehicle profiles
- Saved stations and routes
- User preferences
- Offline charger data
- Trip history

This specification provides detailed technical requirements and user flows for implementing all requested features in the VoltAI application.
