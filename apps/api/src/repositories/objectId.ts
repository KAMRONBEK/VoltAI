import { createHash } from "node:crypto";

/**
 * Content-derived, ObjectId-shaped (24 hex chars) id for a canonical station.
 *
 * The mobile client caches stations keyed on `String(id ?? _id)`, and the merge rewrites the
 * whole `stations` table every cycle — so a rowid/autoincrement id would churn cache identity on
 * every merge. The id is derived from the primary source + that source's OWN external id of the
 * seeding row. Earlier it was keyed on the station NAME + rounded coordinates, which changed
 * whenever the operator renamed a site or (for Tokbor) whenever the name cache was missing or
 * re-enriched — i.e. exactly during the deployment steps the runbook prescribes. The external id
 * is what the operator itself uses to identify the charger, so it is the most stable handle we
 * have. Falls back to the old name/coords key only for legacy rows without an external id.
 */
export function stableStationId(
  primarySource: string,
  primaryExternalId: string | undefined,
  name: string,
  coordinates: [number, number]
): string {
  const [lng, lat] = coordinates;
  const key = primaryExternalId
    ? `${primarySource}|id:${primaryExternalId}`
    : `${primarySource}|${name.trim().toLowerCase()}|${lat.toFixed(4)},${lng.toFixed(4)}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 24);
}
