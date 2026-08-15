export type StationStatus = 'available' | 'in_use' | 'offline' | 'unknown';

export type ChargerCategory = 'ac' | 'dc' | 'ultra' | 'hybrid';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface StationConnector {
  id: string;
  type: string; // e.g. CCS2, Type2, CHAdeMO
  powerKw: number;
  status: StationStatus;
}

export interface StationPricing {
  currency?: string; // e.g. UZS
  perKwh?: number;
  perMinute?: number;
  parkingFee?: number;
}

export interface StationContact {
  phone?: string;
  website?: string;
}

export interface Station {
  id: string;
  name: string;
  location: LatLng;
  address?: string;
  city?: string;
  operator?: string;
  operatorId?: string;
  category?: ChargerCategory;
  maxPowerKw?: number;
  connectors: StationConnector[];
  status: StationStatus; // station-level summary
  pricing?: StationPricing;
  amenities?: string[];
  contact?: StationContact;
}

export type StationsSource = 'api' | 'cache' | 'error';

/**
 * Why a load did not come straight from the API. `empty` is the one the map keeps retrying on its
 * own (the backend answered, it just has no stations yet); the rest wait for the user, the network
 * coming back, or the next foreground.
 */
export type StationsErrorKind = 'empty' | 'unrecognized' | 'http' | 'timeout' | 'network';

export interface StationsListResult {
  stations: Station[];
  source: StationsSource;
  apiError?: string;
  errorKind?: StationsErrorKind;
  /** `source === 'cache'`: when that cache was written (ms epoch). */
  cachedAt?: number;
  /**
   * `source === 'cache'`: false when the cache was old enough that every status in `stations` has
   * been downgraded to `unknown` — availability filtering then means nothing.
   */
  statusesTrusted?: boolean;
  /** `source === 'api'`: the API's reported total. */
  total?: number | null;
  /** `source === 'api'`: when the backend last merged its sources — the age of the statuses. */
  lastMergeAt?: string | null;
}

