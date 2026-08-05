import { createHash } from "node:crypto";

/**
 * Content-derived, ObjectId-shaped (24 hex chars) id for a canonical station.
 *
 * The mobile client caches stations keyed on `String(id ?? _id)`, and the merge rewrites
 * the whole `stations` table every cycle — so a rowid/autoincrement id would churn cache
 * identity on every merge. Deriving the id from the primary source + name + rounded
 * coordinates keeps it stable across merges (and keeps the `/stations/:id` 24-hex guard valid).
 */
export function stableStationId(
  primarySource: string,
  name: string,
  coordinates: [number, number]
): string {
  const [lng, lat] = coordinates;
  const key = `${primarySource}|${name.trim().toLowerCase()}|${lat.toFixed(4)},${lng.toFixed(4)}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 24);
}
