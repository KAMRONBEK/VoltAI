import { MOCK_STATIONS } from '@/data/mock-stations';
import { getJson, setJson } from '@/lib/storage/jsonStorage';
import { StorageKeys } from '@/lib/storage/storageKeys';
import type { Station, StationsListResult, StationStatus } from '@/types/stations';

export const STATIONS_API_URL = 'https://api.voltai.uz/api/stations';

const DEFAULT_TIMEOUT_MS = 6_000;

type StationsCache = {
  updatedAt: number;
  stations: Station[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toStatus(value: unknown): StationStatus {
  if (value === 'available' || value === 'in_use' || value === 'offline' || value === 'unknown') return value;
  // Common variants we might get from APIs.
  if (value === 'in-use' || value === 'busy') return 'in_use';
  if (value === 'down') return 'offline';
  return 'unknown';
}

function extractStationsArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];

  const candidates = [payload.data, payload.stations, payload.results, payload.items];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function normalizeStation(raw: unknown, idx: number): Station | null {
  if (!isRecord(raw)) return null;

  const id = (raw.id ?? raw._id ?? `${idx}`) as unknown;
  const name = raw.name ?? raw.title ?? raw.stationName;

  const latitude =
    toNumber(raw.latitude) ??
    toNumber(raw.lat) ??
    (isRecord(raw.location) ? toNumber(raw.location.latitude ?? raw.location.lat) : null) ??
    (isRecord(raw.coordinates) ? toNumber(raw.coordinates.latitude ?? raw.coordinates.lat) : null);
  const longitude =
    toNumber(raw.longitude) ??
    toNumber(raw.lng) ??
    toNumber(raw.lon) ??
    (isRecord(raw.location) ? toNumber(raw.location.longitude ?? raw.location.lng ?? raw.location.lon) : null) ??
    (isRecord(raw.coordinates) ? toNumber(raw.coordinates.longitude ?? raw.coordinates.lng ?? raw.coordinates.lon) : null);

  if (typeof name !== 'string' || name.trim().length === 0) return null;
  if (latitude === null || longitude === null) return null;

  const connectorsRaw = raw.connectors ?? raw.connectorTypes ?? raw.ports;
  const connectors: Station['connectors'] = [];

  if (Array.isArray(connectorsRaw)) {
    for (let i = 0; i < connectorsRaw.length; i += 1) {
      const c = connectorsRaw[i];
      if (!isRecord(c)) continue;
      const type = c.type ?? c.connectorType ?? c.name;
      const powerKw = toNumber(c.powerKw ?? c.power ?? c.kw) ?? 0;
      if (typeof type !== 'string' || type.trim().length === 0) continue;
      connectors.push({
        id: String(c.id ?? `${idx}-c${i}`),
        type,
        powerKw,
        status: toStatus(c.status),
      });
    }
  }

  const stationStatus = toStatus(raw.status);
  const operator =
    typeof raw.operator === 'string'
      ? raw.operator
      : isRecord(raw.operator) && typeof raw.operator.name === 'string'
        ? raw.operator.name
        : undefined;

  return {
    id: String(id),
    name: name.trim(),
    location: { latitude, longitude },
    address: typeof raw.address === 'string' ? raw.address : undefined,
    city: typeof raw.city === 'string' ? raw.city : undefined,
    operator,
    status: stationStatus,
    connectors,
    amenities: Array.isArray(raw.amenities) ? raw.amenities.filter((a): a is string => typeof a === 'string') : undefined,
    pricing: isRecord(raw.pricing)
      ? {
          currency: typeof raw.pricing.currency === 'string' ? raw.pricing.currency : undefined,
          perKwh: toNumber(raw.pricing.perKwh),
          perMinute: toNumber(raw.pricing.perMinute),
          parkingFee: toNumber(raw.pricing.parkingFee),
        }
      : undefined,
    contact: isRecord(raw.contact)
      ? {
          phone: typeof raw.contact.phone === 'string' ? raw.contact.phone : undefined,
          website: typeof raw.contact.website === 'string' ? raw.contact.website : undefined,
        }
      : undefined,
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadCachedStations(): Promise<Station[] | null> {
  const cached = await getJson<StationsCache>(StorageKeys.stationsCache);
  if (!cached?.stations?.length) return null;
  return cached.stations;
}

async function saveCachedStations(stations: Station[]): Promise<void> {
  const payload: StationsCache = { updatedAt: Date.now(), stations };
  await setJson(StorageKeys.stationsCache, payload);
}

export async function listStations(opts?: {
  url?: string;
  timeoutMs?: number;
}): Promise<StationsListResult> {
  const url = opts?.url ?? STATIONS_API_URL;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) {
      throw new Error(`Stations API HTTP ${res.status}`);
    }

    const json = (await res.json()) as unknown;
    const array = extractStationsArray(json);
    const stations = array.map(normalizeStation).filter((s): s is Station => s !== null);

    // If we can’t parse anything sensible, still fall back to mock so the UI remains usable.
    if (stations.length === 0) {
      const cached = await loadCachedStations();
      if (cached?.length) {
        return {
          stations: cached,
          source: 'mock',
          apiError: 'Stations API responded, but payload was not recognized. Using cached data.',
        };
      }
      return {
        stations: MOCK_STATIONS,
        source: 'mock',
        apiError: 'Stations API responded, but payload was not recognized.',
      };
    }

    // Cache last known good data for offline mode.
    saveCachedStations(stations).catch(() => {});

    return { stations, source: 'api' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load stations.';

    const cached = await loadCachedStations();
    if (cached?.length) {
      return { stations: cached, source: 'mock', apiError: `Offline: ${message}` };
    }

    return { stations: MOCK_STATIONS, source: 'mock', apiError: `Offline: ${message}` };
  }
}

