export type StationsFilters = {
  onlyAvailable: boolean;
  connectorTypes: string[];
  minPowerKw: number | null;
  operators: string[];
  cities: string[];
  amenities: string[];
};

export const DEFAULT_STATIONS_FILTERS: StationsFilters = {
  onlyAvailable: false,
  connectorTypes: [],
  minPowerKw: null,
  operators: [],
  cities: [],
  amenities: [],
};

