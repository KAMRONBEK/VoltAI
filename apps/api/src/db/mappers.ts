/**
 * Row <-> wire-format translation. This is the layer that keeps the HTTP contract
 * byte-compatible with what Mongoose `.lean()` produced, so the mobile data client
 * (apps/mobile/lib/stations/stationsClient.ts) needs zero changes:
 *   - emits `_id` (read as `raw.id ?? raw._id`)
 *   - emits `location` as GeoJSON `{ type: "Point", coordinates: [lng, lat] }`
 *   - preserves `connectors[].power`
 */

export type StationWire = {
  _id: string;
  name: string;
  address?: string;
  location: { type: "Point"; coordinates: [number, number] };
  connectors: Array<{ type: string; power?: number }>;
  workingHours?: string;
  rating?: number;
  description?: string;
  images: string[];
  sources: string[];
  primarySource: string;
  createdAt: string;
  updatedAt: string;
  distanceMeters?: number;
};

function parseJsonArray<T>(value: unknown): T[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function rowToStation(r: Record<string, any>): StationWire {
  return {
    _id: String(r._id),
    name: r.name,
    address: r.address ?? undefined,
    location: { type: "Point", coordinates: [r.lng, r.lat] },
    connectors: parseJsonArray<{ type: string; power?: number }>(r.connectors),
    workingHours: r.working_hours ?? undefined,
    rating: r.rating ?? undefined,
    description: r.description ?? undefined,
    images: parseJsonArray<string>(r.images),
    sources: parseJsonArray<string>(r.sources),
    primarySource: r.primary_source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
