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
  /**
   * What THIS gun can deliver with the cabinet otherwise idle — not the site rating.
   * Several operator APIs report only a site figure; see services/perGunPower.ts for how that is
   * split, and why a site named "60+100kW" must not report 160 on both guns.
   */
  power?: number;
  status?: string;
  /** Charger category for this connector (drives the map high-power/hybrid distinction). */
  category?: ChargerCategory;
  /** The whole site's rating, so consumers can compute the shared-cabinet split themselves. */
  siteMaxKw?: number;
  /** This gun shares a power stack with siblings; expect less than `power` when they are busy. */
  sharedCabinet?: boolean;
  /** What `power` rests on — see PowerBasis in services/perGunPower.ts. */
  powerBasis?: "name" | "site-single" | "site-alternative" | "site-shared" | "unknown";
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
