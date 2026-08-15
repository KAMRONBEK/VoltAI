import { getDb, nowIso } from "../db/sqlite";
import type { RawStationInput } from "../types/station";

/** Shape mergeService consumes (mirrors the old `RawStationModel.find().lean()` docs). */
export type RawStationRecord = {
  source: string;
  externalId: string;
  name: string;
  address?: string;
  location: { type: "Point"; coordinates: [number, number] };
  connectors: Array<{ type: string; power?: number; status?: string }>;
  workingHours?: string;
  rating?: number;
  rawData?: Record<string, unknown>;
  scrapedAt: Date;
};

/**
 * Upsert on (source, external_id) — the SQLite equivalent of the old
 * `RawStationModel.bulkWrite([{ updateOne: { filter, upsert: true } }])`. Wrapped in one
 * transaction so N rows cost one fsync.
 */
export function upsertRawStations(inputs: RawStationInput[]): number {
  const db = getDb();
  const now = nowIso();
  let count = 0;
  db.exec("BEGIN");
  try {
    for (const s of inputs) {
      const [lng, lat] = s.location.coordinates;
      db.run(
        `INSERT INTO raw_stations
           (source, external_id, name, address, lng, lat, connectors,
            working_hours, rating, raw_data, scraped_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(source, external_id) DO UPDATE SET
           name=excluded.name, address=excluded.address,
           lng=excluded.lng, lat=excluded.lat,
           connectors=excluded.connectors, working_hours=excluded.working_hours,
           rating=excluded.rating, raw_data=excluded.raw_data,
           scraped_at=excluded.scraped_at, updated_at=excluded.updated_at`,
        [
          s.source,
          s.externalId,
          s.name,
          s.address ?? null,
          lng,
          lat,
          JSON.stringify(s.connectors ?? []),
          s.workingHours ?? null,
          s.rating ?? null,
          s.rawData ? JSON.stringify(s.rawData) : null,
          (s.scrapedAt ?? new Date()).toISOString(),
          now,
          now,
        ]
      );
      count += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return count;
}

export function listAllRawStations(): RawStationRecord[] {
  // Deterministic order: the merge seeds each cluster from the FIRST row it sees, and that seed
  // decides the canonical id/name/coords — so the scan order must not depend on SQLite internals.
  const rows = getDb().all("SELECT * FROM raw_stations ORDER BY id") as Record<string, any>[];
  return rows.map((r) => ({
    source: r.source,
    externalId: r.external_id,
    name: r.name,
    address: r.address ?? undefined,
    location: { type: "Point" as const, coordinates: [r.lng, r.lat] as [number, number] },
    connectors: parseConnectors(r.connectors),
    workingHours: r.working_hours ?? undefined,
    rating: r.rating ?? undefined,
    rawData: parseRawData(r.raw_data),
    scrapedAt: r.scraped_at ? new Date(r.scraped_at) : new Date(),
  }));
}

/**
 * Forget raw rows that no scrape has reported for `retentionDays`. The raw table is upsert-only,
 * so without this a charger an operator decommissioned would stay in the merge input forever
 * (frozen at its last status). Rows are only pruned once they are far older than the
 * status-freshness window, so a source that is merely down for a while keeps its stations
 * (with statuses shown as unknown — see mergeService) rather than losing them.
 */
export function pruneRawStations(retentionDays: number): number {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const db = getDb();
  const before = countRawStations();
  db.run("DELETE FROM raw_stations WHERE scraped_at < ?", [cutoff]);
  return before - countRawStations();
}

export function countRawStations(): number {
  const row = getDb().get("SELECT COUNT(*) AS n FROM raw_stations") as { n: number } | null;
  return row?.n ?? 0;
}

function parseConnectors(value: unknown): Array<{ type: string; power?: number; status?: string }> {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseRawData(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
