import { listAllRawStations } from "../repositories/rawStationRepo";
import { replaceAllStations } from "../repositories/stationRepo";
import { distanceMeters, nameTokens, similarityFromTokens, type NameTokens } from "../../scrapers/utils/geo";
import type { Connector, SourceId } from "../types/station";

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
  updatedAt: Date;
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

  const sorted = rawStations.sort((a, b) => getPriority(a.source) - getPriority(b.source));

  for (const raw of sorted) {
    const rawSource = raw.source as SourceId;
    const rawName = raw.name ?? "";
    const rawCoords = raw.location?.coordinates as [number, number] | undefined;
    if (!rawCoords || rawCoords.length !== 2 || !rawName) {
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
        connectors: (raw.connectors ?? []).map((item) => ({ ...item })),
        workingHours: raw.workingHours ?? undefined,
        rating: raw.rating ?? undefined,
        description: extractDescription(raw.rawData),
        images: extractImages(raw.rawData),
        sources: [rawSource],
        primarySource: rawSource,
        updatedAt: new Date()
      });
      continue;
    }

    const target = merged[foundIndex];
    if (!target.sources.includes(rawSource)) {
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
      target.name = rawName || target.name;
      if (rawName) mergedTokens[foundIndex] = rawTokens;
      target.address = raw.address ?? target.address;
      target.location.coordinates = rawCoords;
      target.workingHours = raw.workingHours ?? target.workingHours;
      target.rating = raw.rating ?? target.rating;
      target.description = extractDescription(raw.rawData) ?? target.description;
    }

    if (raw.connectors?.length) {
      const seen = new Set(target.connectors.map(connectorKey));
      for (const connector of raw.connectors) {
        const key = connectorKey(connector);
        if (!seen.has(key)) {
          target.connectors.push({ ...connector });
          seen.add(key);
        }
      }
    }
    mergeImages(target, extractImages(raw.rawData));
    target.updatedAt = new Date();
  }

  // One atomic replace (BEGIN IMMEDIATE) instead of the old non-atomic deleteMany+insertMany.
  replaceAllStations(merged);

  return { mergedCount: merged.length };
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
