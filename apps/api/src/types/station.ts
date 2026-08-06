export type SourceId =
  | "tokbor"
  | "spectre-energy"
  | "megawatt-energy"
  | "k-watt"
  | "pro-tok"
  | "beon"
  | "yandex-maps"
  | "google-maps";

export interface GeoPoint {
  type: "Point";
  coordinates: [number, number];
}

/** Charger category used to distinguish e.g. high-power DC from hybrid/AC on the map. */
export type ChargerCategory = "ac" | "dc" | "ultra" | "hybrid";

export interface Connector {
  type: string;
  power?: number;
  status?: string;
  /** Charger category for this connector (drives the map high-power/hybrid distinction). */
  category?: ChargerCategory;
  /** How many physical connectors of this type/power the station has. */
  count?: number;
  /** Price per kWh in minor-unit-free local currency (e.g. UZS sum). */
  pricePerKwh?: number;
  /** Idle/parking fee (per the operator's own unit). */
  parkingFee?: number;
  currency?: string;
}

export interface RawStationInput {
  source: SourceId;
  externalId: string;
  name: string;
  address?: string;
  location: GeoPoint;
  connectors?: Connector[];
  workingHours?: string;
  rating?: number;
  rawData?: Record<string, unknown>;
  scrapedAt?: Date;
}

export interface CanonicalStationInput {
  name: string;
  address?: string;
  location: GeoPoint;
  connectors?: Connector[];
  workingHours?: string;
  rating?: number;
  description?: string;
  images?: string[];
  sources: SourceId[];
  primarySource: SourceId;
  updatedAt?: Date;
}
