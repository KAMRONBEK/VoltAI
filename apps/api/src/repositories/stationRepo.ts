import { getDistance } from "geolib";
import { getDb, nowIso } from "../db/sqlite";
import { rowToStation, type StationWire } from "../db/mappers";
import { stableStationId } from "./objectId";
import { setMeta } from "./metaRepo";
import type { CanonicalStationInput } from "../types/station";

/** GET /api/stations — pagination + optional text query. Was `.find().skip().limit().sort()`. */
export function listStations(opts: { page: number; limit: number; q?: string }): {
  items: StationWire[];
  total: number;
} {
  const db = getDb();
  const page = Math.max(opts.page, 1);
  const limit = Math.max(opts.limit, 1);
  const offset = (page - 1) * limit;

  const q = opts.q?.trim();
  if (q) {
    const match = toFtsQuery(q);
    const items = db.all(
      `SELECT s.* FROM stations_fts f
         JOIN stations s ON s.rowid = f.rowid
        WHERE stations_fts MATCH ?
        ORDER BY s.updated_at DESC, s._id
        LIMIT ? OFFSET ?`,
      [match, limit, offset]
    ) as Record<string, any>[];
    const totalRow = db.get(
      `SELECT COUNT(*) AS n FROM stations_fts WHERE stations_fts MATCH ?`,
      [match]
    ) as { n: number } | null;
    return { items: items.map(rowToStation), total: totalRow?.n ?? 0 };
  }

  const items = db.all(
    `SELECT * FROM stations ORDER BY updated_at DESC, _id LIMIT ? OFFSET ?`,
    [limit, offset]
  ) as Record<string, any>[];
  const totalRow = db.get(`SELECT COUNT(*) AS n FROM stations`) as { n: number } | null;
  return { items: items.map(rowToStation), total: totalRow?.n ?? 0 };
}

/**
 * GET /api/stations/nearby — was Mongo `$geoNear`. Bounding-box prefilter on the (lat,lng)
 * index, then exact haversine via geolib, sorted, capped at 200, emitting `distanceMeters`
 * on each item exactly as `$geoNear`'s `distanceField` did. The bbox is a square, so the
 * `<= radiusM` filter turns it back into a circle.
 */
export function nearbyStations(lat: number, lng: number, radiusM: number): StationWire[] {
  const db = getDb();
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6));

  const rows = db.all(
    `SELECT * FROM stations WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
    [lat - dLat, lat + dLat, lng - dLng, lng + dLng]
  ) as Record<string, any>[];

  return rows
    .map((r) => ({
      station: rowToStation(r),
      distanceMeters: getDistance({ latitude: lat, longitude: lng }, { latitude: r.lat, longitude: r.lng }),
    }))
    .filter((x) => x.distanceMeters <= radiusM)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 200)
    .map((x) => ({ ...x.station, distanceMeters: x.distanceMeters }));
}

/** GET /api/stations/search — was Mongo `$text` + textScore sort. bm25 weights name 2x. */
export function searchStations(q: string): StationWire[] {
  const rows = getDb().all(
    `SELECT s.* FROM stations_fts f
       JOIN stations s ON s.rowid = f.rowid
      WHERE stations_fts MATCH ?
      ORDER BY bm25(stations_fts, 2.0, 1.0)
      LIMIT 100`,
    [toFtsQuery(q)]
  ) as Record<string, any>[];
  return rows.map(rowToStation);
}

export function getStationById(id: string): StationWire | null {
  const row = getDb().get(`SELECT * FROM stations WHERE _id = ?`, [id]) as Record<string, any> | null;
  return row ? rowToStation(row) : null;
}

/**
 * Compact live-status projection for consumer apps to poll cheaply — id + overall status +
 * per-connector status only (no coords/name/pricing/images). Lets a client fetch the full
 * catalog once from `/api/stations`, then refresh statuses every minute against a payload that
 * is an order of magnitude smaller. Status/category are derived exactly as the full endpoint
 * (via rowToStation), so the two never disagree.
 */
export type StationStatusWire = {
  id: string;
  status: StationWire["status"];
  category: StationWire["category"];
  connectors: Array<{ type: string; status?: string }>;
  updatedAt: string;
};

export function listStationStatuses(): StationStatusWire[] {
  // Only the columns rowToStation needs to derive status/category (connectors) plus id/updated.
  const rows = getDb().all(
    `SELECT _id, connectors, updated_at FROM stations ORDER BY updated_at DESC`
  ) as Record<string, any>[];
  return rows.map((r) => {
    const s = rowToStation(r);
    return {
      id: s._id,
      status: s.status,
      category: s.category,
      connectors: s.connectors.map((c) => ({ type: c.type, status: c.status })),
      updatedAt: s.updatedAt,
    };
  });
}

export function countStations(): number {
  const row = getDb().get(`SELECT COUNT(*) AS n FROM stations`) as { n: number } | null;
  return row?.n ?? 0;
}

/**
 * Replaces the canonical `stations` table in one transaction (was `deleteMany({})` +
 * `insertMany()` — two separate, non-atomic ops). `BEGIN IMMEDIATE` means a concurrent read
 * sees either the whole old set or the whole new set, never an empty table mid-rebuild.
 */
export function replaceAllStations(stations: CanonicalStationInput[]): number {
  const db = getDb();
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM stations");
    for (const s of stations) {
      const [lng, lat] = s.location.coordinates;
      const id = stableStationId(s.primarySource, s.primaryExternalId, s.name, s.location.coordinates);
      const updatedAt = s.updatedAt ? new Date(s.updatedAt).toISOString() : now;
      db.run(
        `INSERT OR REPLACE INTO stations
           (_id, name, address, lng, lat, connectors, working_hours, rating,
            description, images, sources, primary_source, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          s.name,
          s.address ?? null,
          lng,
          lat,
          JSON.stringify(s.connectors ?? []),
          s.workingHours ?? null,
          s.rating ?? null,
          s.description ?? null,
          JSON.stringify(s.images ?? []),
          JSON.stringify(s.sources ?? []),
          s.primarySource,
          now,
          updatedAt,
        ]
      );
    }
    // Repopulate the external-content FTS index from the fresh stations table.
    db.exec("INSERT INTO stations_fts(stations_fts) VALUES('rebuild')");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  setMeta("lastMergeAt", now);
  return stations.length;
}

/** Sanitize user input for FTS5 MATCH — bare `-`, `"`, `*`, `(`, NEAR etc. are operators. */
function toFtsQuery(q: string): string {
  const terms = q.toLowerCase().replace(/["*()]/g, " ").split(/\s+/).filter(Boolean);
  if (!terms.length) return '""';
  return terms.map((t) => `"${t}"*`).join(" AND ");
}
