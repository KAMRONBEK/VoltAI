import { getJson, setJson } from '@/lib/storage/jsonStorage';
import { StorageKeys } from '@/lib/storage/storageKeys';
import type { Station, StationsListResult, StationStatus } from '@/types/stations';

// Base URL is overridable via EXPO_PUBLIC_API_BASE_URL for local/staging dev (e.g. pointing
// at a locally-run API through `adb reverse`); defaults to production.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.voltai.uz';
export const STATIONS_API_URL = `${API_BASE_URL}/api/stations`;
// Compact near-real-time status feed (id + overall + per-connector status). Polled on the map
// so charger dots reflect the backend's ~5-min status refresh without re-downloading the catalog.
export const STATION_STATUSES_API_URL = `${API_BASE_URL}/api/stations/statuses`;

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

function geoJsonPointToLatLng(value: unknown): { latitude: number; longitude: number } | null {
  // Supports common API shapes:
  // - { type: "Point", coordinates: [lng, lat] }
  // - { coordinates: [lng, lat] }
  // - [lng, lat]
  const coords = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.coordinates)
      ? value.coordinates
      : null;

  if (!coords || coords.length < 2) return null;
  const longitude = toNumber(coords[0]);
  const latitude = toNumber(coords[1]);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
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

  const geoFromLocation = isRecord(raw.location) ? geoJsonPointToLatLng(raw.location) : null;
  const geoFromCoordinates = geoJsonPointToLatLng(raw.coordinates);

  const latitude =
    toNumber(raw.latitude) ??
    toNumber(raw.lat) ??
    (isRecord(raw.location) ? toNumber(raw.location.latitude ?? raw.location.lat) : null) ??
    (isRecord(raw.coordinates) ? toNumber(raw.coordinates.latitude ?? raw.coordinates.lat) : null) ??
    geoFromLocation?.latitude ??
    geoFromCoordinates?.latitude ??
    null;
  const longitude =
    toNumber(raw.longitude) ??
    toNumber(raw.lng) ??
    toNumber(raw.lon) ??
    (isRecord(raw.location) ? toNumber(raw.location.longitude ?? raw.location.lng ?? raw.location.lon) : null) ??
    (isRecord(raw.coordinates) ? toNumber(raw.coordinates.longitude ?? raw.coordinates.lng ?? raw.coordinates.lon) : null) ??
    geoFromLocation?.longitude ??
    geoFromCoordinates?.longitude ??
    null;

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
  const operatorId =
    typeof raw.operatorId === 'string'
      ? raw.operatorId
      : typeof raw.primarySource === 'string'
        ? raw.primarySource
        : undefined;
  const category =
    raw.category === 'ac' || raw.category === 'dc' || raw.category === 'ultra' || raw.category === 'hybrid'
      ? raw.category
      : undefined;
  const maxPowerKw = toNumber(raw.maxPowerKw) ?? undefined;

  return {
    id: String(id),
    name: name.trim(),
    location: { latitude, longitude },
    address: typeof raw.address === 'string' ? raw.address : undefined,
    city: typeof raw.city === 'string' ? raw.city : undefined,
    operator,
    operatorId,
    category,
    maxPowerKw,
    status: stationStatus,
    connectors,
    amenities: Array.isArray(raw.amenities) ? raw.amenities.filter((a): a is string => typeof a === 'string') : undefined,
    pricing: isRecord(raw.pricing)
      ? {
          currency: typeof raw.pricing.currency === 'string' ? raw.pricing.currency : undefined,
          perKwh: toNumber(raw.pricing.perKwh) ?? undefined,
          perMinute: toNumber(raw.pricing.perMinute) ?? undefined,
          parkingFee: toNumber(raw.pricing.parkingFee) ?? undefined,
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

function buildPageUrl(baseUrl: string, page?: number, limit?: number): string {
  const u = new URL(baseUrl);
  if (typeof page === 'number' && Number.isFinite(page)) u.searchParams.set('page', String(page));
  if (typeof limit === 'number' && Number.isFinite(limit)) u.searchParams.set('limit', String(limit));
  return u.toString();
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetchWithTimeout(url, timeoutMs);
  if (!res.ok) {
    throw new Error(`Stations API HTTP ${res.status}`);
  }
  return (await res.json()) as unknown;
}

// The map needs EVERY station, but the API paginates (default 50, max 200 per page).
// Walk all pages until we've collected `total` (bounded so a misbehaving API can't loop forever).
const PAGE_SIZE = 200;
const MAX_PAGES = 100;

async function fetchAllRawStations(baseUrl: string, timeoutMs: number): Promise<unknown[]> {
  const all: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const json = await fetchJson(buildPageUrl(baseUrl, page, PAGE_SIZE), timeoutMs);
    const items = extractStationsArray(json);
    all.push(...items);

    const total = isRecord(json) ? toNumber(json.total) : null;
    if (items.length === 0) break; // no more data
    if (total !== null && all.length >= total) break; // got everything
    if (items.length < PAGE_SIZE) break; // last (short) page
  }
  return all;
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

/** One station's live status: overall + per-connector, in the same order as its catalog connectors. */
export type StationStatusUpdate = {
  id: string;
  status: StationStatus;
  connectors: StationStatus[];
  updatedAt?: string;
};

/**
 * Result of a status poll:
 * - `updates`: a fresh 200 response — apply `updates` and remember `etag` for next time.
 * - `not-modified`: server returned 304 (nothing changed since `etag`) — keep current state.
 * - `null`: the poll failed (offline/timeout) — best-effort, keep last-known statuses on screen.
 */
export type StationStatusPollResult =
  | { kind: 'updates'; updates: StationStatusUpdate[]; etag: string | null }
  | { kind: 'not-modified' };

/**
 * Poll the compact status feed. Pass the `etag` from the previous `updates` result so the server
 * can answer `304 Not Modified` (0 bytes, no JSON to parse) between the ~5-min scrapes. ~24 KB
 * gzipped when it does change.
 */
export async function fetchStationStatuses(opts?: {
  url?: string;
  timeoutMs?: number;
  etag?: string | null;
}): Promise<StationStatusPollResult | null> {
  const url = opts?.url ?? STATION_STATUSES_API_URL;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (opts?.etag) headers['If-None-Match'] = opts.etag;

    const res = await fetch(url, { signal: controller.signal, headers });

    // Nothing changed since our last successful poll — skip parsing and re-rendering entirely.
    if (res.status === 304) return { kind: 'not-modified' };
    if (!res.ok) return null;

    const json = (await res.json()) as unknown;
    const arr = extractStationsArray(json);
    const out: StationStatusUpdate[] = [];
    for (const item of arr) {
      if (!isRecord(item)) continue;
      const id = item.id ?? item._id;
      if (typeof id !== 'string' && typeof id !== 'number') continue;
      const connectors = Array.isArray(item.connectors)
        ? item.connectors.map((c) => (isRecord(c) ? toStatus(c.status) : toStatus(undefined)))
        : [];
      out.push({
        id: String(id),
        status: toStatus(item.status),
        connectors,
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
      });
    }
    return { kind: 'updates', updates: out, etag: res.headers.get('etag') };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function listStations(opts?: {
  url?: string;
  timeoutMs?: number;
  page?: number;
  limit?: number;
}): Promise<StationsListResult> {
  const baseUrl = opts?.url ?? STATIONS_API_URL;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const explicitPage = typeof opts?.page === 'number' && Number.isFinite(opts.page);

  try {
    // Default (map) mode fetches every page so all operators' stations show.
    // An explicit `page` opt still fetches just that single page (backward compat).
    const array = explicitPage
      ? extractStationsArray(await fetchJson(buildPageUrl(baseUrl, opts?.page, opts?.limit), timeoutMs))
      : await fetchAllRawStations(baseUrl, timeoutMs);
    const stations = array.map(normalizeStation).filter((s): s is Station => s !== null);

    // If we can’t parse anything sensible, fall back to last-known-good cache.
    // With no cache we show an empty map + error state — never fabricated stations.
    if (stations.length === 0) {
      const cached = await loadCachedStations();
      if (cached?.length) {
        return {
          stations: cached,
          source: 'cache',
          apiError: 'Stations API responded, but payload was not recognized. Using cached data.',
        };
      }
      return {
        stations: [],
        source: 'error',
        apiError: 'Could not load stations right now. Pull to retry.',
      };
    }

    // Cache last known good data for offline mode.
    saveCachedStations(stations).catch(() => {});

    return { stations, source: 'api' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load stations.';

    const cached = await loadCachedStations();
    if (cached?.length) {
      return { stations: cached, source: 'cache', apiError: `Offline: ${message}` };
    }

    return {
      stations: [],
      source: 'error',
      apiError: 'Offline — no stations cached yet. Check your connection and pull to retry.',
    };
  }
}

