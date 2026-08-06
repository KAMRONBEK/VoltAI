import { listAllRawStations } from "../repositories/rawStationRepo";
import { replaceAllStations } from "../repositories/stationRepo";
import { distanceMeters, nameSimilarity } from "../../scrapers/utils/geo";
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

export async function mergeStations(): Promise<{ mergedCount: number }> {
  const rawStations = listAllRawStations();
  const merged: MergeStation[] = [];

  const sorted = rawStations.sort((a, b) => getPriority(a.source) - getPriority(b.source));

  for (const raw of sorted) {
    const rawSource = raw.source as SourceId;
    const rawName = raw.name ?? "";
    const rawCoords = raw.location?.coordinates as [number, number] | undefined;
    if (!rawCoords || rawCoords.length !== 2 || !rawName) {
      continue;
    }
    const foundIndex = merged.findIndex((existing) => {
      const distance = distanceMeters(existing.location.coordinates, rawCoords);
      const similarity = nameSimilarity(existing.name, rawName);
      const distanceLimit = similarity >= 0.7 ? 80 : 40;
      return distance <= distanceLimit && similarity >= 0.5;
    });

    if (foundIndex === -1) {
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
      target.primarySource = rawSource;
      target.name = rawName || target.name;
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
