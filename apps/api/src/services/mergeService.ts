import { listAllRawStations } from "../repositories/rawStationRepo";
import { replaceAllStations } from "../repositories/stationRepo";
import { distanceMeters, nameTokens, similarityFromTokens, type NameTokens } from "../../scrapers/utils/geo";
import type { Connector, SourceId } from "../types/station";
import { envInt } from "../env";

const sourcePriority: SourceId[] = [
  "tokbor",
  "spectre-energy",
  "megawatt-energy",
  "k-watt",
  "pro-tok",
  "beon",
  "yandex-maps",
  "google-maps"
];

const priorityIndex = new Map(sourcePriority.map((source, index) => [source, index]));

interface MergeStation {
  name: string;
  address?: string;
  location: { type: "Point"; coordinates: [number, number] };
  connectors: Connector[];
  workingHours?: string;
  rating?: number;
  description?: string;
  images: string[];
  sources: SourceId[];
  primarySource: SourceId;
  /** External id of the raw row that seeded this record — the canonical id is derived from it. */
  primaryExternalId: string;
  /** Newest scrape time among the contributing raw rows (what the wire's `updatedAt` reports). */
  updatedAt: Date;
}

/**
 * Freshness policy for what a raw row is still allowed to claim.
 * - Older than STATION_TTL_DAYS: the row is ignored entirely (an operator removed the charger, or
 *   the source has been dead for a week — either way it must not be on the map as "live").
 * - Older than STATUS_MAX_AGE_SEC (default 1 h ≈ 12+ missed 3-5 min scrapes): the row still
 *   places the station on the map, but its connector statuses are downgraded to `unknown` so a
 *   frozen "available" from a source whose token expired is never presented as current.
 */
const STATION_TTL_MS = envInt("STATION_TTL_DAYS", 7, { min: 1 }) * 86_400_000;
const STATUS_MAX_AGE_MS = envInt("STATUS_MAX_AGE_SEC", 3600, { min: 60 }) * 1000;

function freshConnectors(raw: { connectors: Connector[] | undefined; scrapedAt: Date }, now: number): Connector[] {
  const list = (raw.connectors ?? []).map((item) => ({ ...item }));
  if (now - raw.scrapedAt.getTime() > STATUS_MAX_AGE_MS) {
    for (const c of list) c.status = "unknown";
  }
  return list;
}

/** Identity of a connector for dedup — same plug type + power = same slot. */
function connectorKey(c: Connector): string {
  return `${c.type}-${c.power ?? ""}`;
}

/**
 * Spatial bucket size, in degrees, for the dedup index.
 *
 * The widest distance at which two rows can merge is 80 m. At Uzbek latitudes 0.001 deg is about
 * 111 m of latitude and 84 m of longitude, so both cell dimensions exceed 80 m and a 3x3 block
 * around a point is guaranteed to contain every row it could possibly merge with. Anything
 * outside that block is unreachable by definition, not merely unlikely.
 */
const CELL_DEG = 0.001;

function cellKey(lat: number, lng: number): string {
  return `${Math.floor(lat / CELL_DEG)}:${Math.floor(lng / CELL_DEG)}`;
}

export async function mergeStations(): Promise<{ mergedCount: number }> {
  const rawStations = listAllRawStations();
  const merged: MergeStation[] = [];

  // Index-aligned with `merged`. Kept alongside rather than on the record so the persisted shape
  // stays exactly what replaceAllStations expects.
  const mergedTokens: NameTokens[] = [];
  /** cell key -> indices into `merged` that fall in that cell. */
  const grid = new Map<string, number[]>();

  const now = Date.now();
  // Stable sort by source priority; ties keep raw-row order (listAllRawStations orders by id).
  const sorted = rawStations.sort((a, b) => getPriority(a.source) - getPriority(b.source));

  for (const raw of sorted) {
    const rawSource = raw.source as SourceId;
    const rawName = raw.name ?? "";
    const rawCoords = raw.location?.coordinates as [number, number] | undefined;
    if (!rawCoords || rawCoords.length !== 2 || !rawName) {
      continue;
    }
    if (now - raw.scrapedAt.getTime() > STATION_TTL_MS) {
      continue;
    }

    const [rawLng, rawLat] = rawCoords;
    const rawTokens = nameTokens(rawName);

    // Only rows in the 3x3 block around this point can be within the 80 m ceiling, so the scan
    // is over a handful of neighbours instead of every station merged so far. This replaces an
    // O(n^2) findIndex that ran ~2M distance + name comparisons per cycle.
    //
    // `findIndex` returned the EARLIEST matching row, and callers depend on that (it decides
    // which record absorbs the others), so candidates are gathered first and the lowest index
    // wins — visiting cells in map order would otherwise silently pick a different winner.
    let foundIndex = -1;
    const baseLat = Math.floor(rawLat / CELL_DEG);
    const baseLng = Math.floor(rawLng / CELL_DEG);
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLng = -1; dLng <= 1; dLng++) {
        const bucket = grid.get(`${baseLat + dLat}:${baseLng + dLng}`);
        if (!bucket) continue;
        for (const idx of bucket) {
          if (foundIndex !== -1 && idx > foundIndex) continue;
          const existing = merged[idx];
          const similarity = similarityFromTokens(mergedTokens[idx], rawTokens);
          if (similarity < 0.5) continue;
          const distanceLimit = similarity >= 0.7 ? 80 : 40;
          if (distanceMeters(existing.location.coordinates, rawCoords) > distanceLimit) continue;
          foundIndex = idx;
        }
      }
    }

    if (foundIndex === -1) {
      const index = merged.length;
      mergedTokens.push(rawTokens);
      const key = cellKey(rawLat, rawLng);
      const bucket = grid.get(key);
      if (bucket) bucket.push(index);
      else grid.set(key, [index]);
      merged.push({
        name: rawName,
        address: raw.address ?? undefined,
        location: {
          type: "Point",
          coordinates: rawCoords
        },
        connectors: freshConnectors(raw, now),
        workingHours: raw.workingHours ?? undefined,
        rating: raw.rating ?? undefined,
        description: extractDescription(raw.rawData),
        images: extractImages(raw.rawData),
        sources: [rawSource],
        primarySource: rawSource,
        primaryExternalId: raw.externalId,
        updatedAt: raw.scrapedAt
      });
      continue;
    }

    const target = merged[foundIndex];
    // Same operator reporting another post/gun at this site (Spectre emits one row per gun,
    // Tokbor one per post): those are DISTINCT physical connectors and must all be kept. Only
    // rows from a DIFFERENT source describe the same hardware twice and get deduplicated.
    const sameSourceSibling = target.sources.includes(rawSource);
    if (!sameSourceSibling) {
      target.sources.push(rawSource);
    }

    const targetPriority = getPriority(target.primarySource);
    const rawPriority = getPriority(rawSource);
    if (rawPriority < targetPriority) {
      // A higher-priority source takes over the record's identity, which moves BOTH the name and
      // the coordinates. The old scan re-derived those from the record on every comparison, so it
      // always saw current values; the index must be maintained by hand to match. Skipping this
      // would leave later rows matching against a name and cell the record no longer has.
      const prevCell = cellKey(target.location.coordinates[1], target.location.coordinates[0]);
      const nextCell = cellKey(rawLat, rawLng);
      if (prevCell !== nextCell) {
        const from = grid.get(prevCell);
        if (from) {
          const at = from.indexOf(foundIndex);
          if (at !== -1) from.splice(at, 1);
        }
        const to = grid.get(nextCell);
        if (to) to.push(foundIndex);
        else grid.set(nextCell, [foundIndex]);
      }

      target.primarySource = rawSource;
      target.primaryExternalId = raw.externalId;
      target.name = rawName || target.name;
      if (rawName) mergedTokens[foundIndex] = rawTokens;
      target.address = raw.address ?? target.address;
      target.location.coordinates = rawCoords;
      target.workingHours = raw.workingHours ?? target.workingHours;
      target.rating = raw.rating ?? target.rating;
      target.description = extractDescription(raw.rawData) ?? target.description;
    }

    if (sameSourceSibling && rawSource === target.primarySource) {
      // Same operator, another post/gun of the seed's own site: keep the id anchored to the
      // operator's SMALLEST external id for the site, not to whichever row happened to be scanned
      // first — so pruning/re-adding one post never renames the station.
      if (compareExternalIds(raw.externalId, target.primaryExternalId) < 0) {
        target.primaryExternalId = raw.externalId;
      }
    }

    if (raw.connectors?.length) {
      const incoming = freshConnectors(raw, now);
      if (sameSourceSibling && rawSource === target.primarySource) {
        // Only the PRIMARY source's own siblings are appended wholesale (they are distinct guns);
        // any other source describing this site is deduplicated against what is already there.
        target.connectors.push(...incoming);
      } else {
        const seen = new Set(target.connectors.map(connectorKey));
        for (const connector of incoming) {
          const key = connectorKey(connector);
          if (!seen.has(key)) {
            target.connectors.push(connector);
            seen.add(key);
          }
        }
      }
    }
    mergeImages(target, extractImages(raw.rawData));
    if (raw.scrapedAt.getTime() > target.updatedAt.getTime()) {
      target.updatedAt = raw.scrapedAt;
    }
  }

  // One atomic replace (BEGIN IMMEDIATE) instead of the old non-atomic deleteMany+insertMany.
  replaceAllStations(merged);

  return { mergedCount: merged.length };
}

/** Numeric-aware ordering of operator external ids ("12" < "100"; falls back to string order). */
function compareExternalIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && /^\d+$/.test(a) && /^\d+$/.test(b)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function getPriority(source: string): number {
  return priorityIndex.get(source as SourceId) ?? Number.MAX_SAFE_INTEGER;
}

function extractDescription(rawData: unknown): string | undefined {
  if (!rawData || typeof rawData !== "object") {
    return undefined;
  }
  const value = (rawData as Record<string, unknown>).description;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractImages(rawData: unknown): string[] {
  if (!rawData || typeof rawData !== "object") {
    return [];
  }
  const value = (rawData as Record<string, unknown>).images;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string").slice(0, 8);
}

function mergeImages(target: MergeStation, images: string[]): void {
  if (!images.length) {
    return;
  }
  const seen = new Set(target.images);
  for (const image of images) {
    if (!seen.has(image)) {
      target.images.push(image);
      seen.add(image);
    }
  }
}
