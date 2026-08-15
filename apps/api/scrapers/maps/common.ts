import { upsertRawStations as upsertRawStationsSqlite } from "../../src/repositories/rawStationRepo";
import type { RawStationInput, SourceId } from "../../src/types/station";

/** Upsert map-scraper output into the embedded SQLite raw_stations table (dev-box tool). */
export async function upsertRawStations(stations: RawStationInput[]): Promise<void> {
  if (!stations.length) {
    return;
  }
  upsertRawStationsSqlite(stations);
}

export function createStationFromMapCard(input: {
  source: SourceId;
  externalId: string;
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  rawData?: Record<string, unknown>;
}): RawStationInput | null {
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    return null;
  }
  return {
    source: input.source,
    externalId: input.externalId,
    name: input.name,
    address: input.address,
    location: {
      type: "Point",
      coordinates: [input.lng as number, input.lat as number]
    },
    rawData: input.rawData ?? {},
    scrapedAt: new Date()
  };
}
