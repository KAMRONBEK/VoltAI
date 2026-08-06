import type { ChargerCategory } from '@/types/stations';

export type StationsFilters = {
  onlyAvailable: boolean;
  categories: ChargerCategory[];
  connectorTypes: string[];
  minPowerKw: number | null;
  operators: string[];
  cities: string[];
  amenities: string[];
};

export const DEFAULT_STATIONS_FILTERS: StationsFilters = {
  onlyAvailable: false,
  categories: [],
  connectorTypes: [],
  minPowerKw: null,
  operators: [],
  cities: [],
  amenities: [],
};

