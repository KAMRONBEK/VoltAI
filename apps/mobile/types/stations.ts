export type StationStatus = 'available' | 'in_use' | 'offline' | 'unknown';

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
  connectors: StationConnector[];
  status: StationStatus; // station-level summary
  pricing?: StationPricing;
  amenities?: string[];
  contact?: StationContact;
}

export type StationsSource = 'api' | 'mock';

export interface StationsListResult {
  stations: Station[];
  source: StationsSource;
  apiError?: string;
}

