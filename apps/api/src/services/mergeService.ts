import { RawStationModel } from "../models/RawStation";
import { StationModel } from "../models/Station";
import { distanceMeters, nameSimilarity } from "../../scrapers/utils/geo";
import type { SourceId } from "../types/station";

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
  connectors: Array<{ type: string; power?: number }>;
  workingHours?: string;
  rating?: number;
  sources: SourceId[];
  primarySource: SourceId;
  updatedAt: Date;
}

export async function mergeStations(): Promise<{ mergedCount: number }> {
  const rawStations = await RawStationModel.find().lean();
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
      return distance <= 50 && similarity >= 0.6;
    });

    if (foundIndex === -1) {
      merged.push({
        name: rawName,
        address: raw.address ?? undefined,
        location: {
          type: "Point",
          coordinates: rawCoords
        },
        connectors: (raw.connectors ?? []).map((item) => ({
          type: item.type,
          power: item.power ?? undefined
        })),
        workingHours: raw.workingHours ?? undefined,
        rating: raw.rating ?? undefined,
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
    }

    if (raw.connectors?.length) {
      const seen = new Set(target.connectors.map((c) => `${c.type}-${c.power ?? ""}`));
      for (const connector of raw.connectors) {
        const key = `${connector.type}-${connector.power ?? ""}`;
        if (!seen.has(key)) {
          target.connectors.push({ type: connector.type, power: connector.power ?? undefined });
          seen.add(key);
        }
      }
    }
    target.updatedAt = new Date();
  }

  await StationModel.deleteMany({});
  if (merged.length > 0) {
    await StationModel.insertMany(merged);
  }

  return { mergedCount: merged.length };
}

function getPriority(source: string): number {
  return priorityIndex.get(source as SourceId) ?? Number.MAX_SAFE_INTEGER;
}
