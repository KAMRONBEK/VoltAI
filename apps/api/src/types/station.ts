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

export interface Connector {
  type: string;
  power?: number;
  status?: string;
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
