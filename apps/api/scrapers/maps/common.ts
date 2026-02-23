import { RawStationModel } from "../../src/models/RawStation";
import type { RawStationInput, SourceId } from "../../src/types/station";

export async function upsertRawStations(stations: RawStationInput[]): Promise<void> {
  if (!stations.length) {
    return;
  }

  const ops = stations.map((station) => ({
    updateOne: {
      filter: { source: station.source, externalId: station.externalId },
      update: { $set: { ...station, scrapedAt: station.scrapedAt ?? new Date() } },
      upsert: true
    }
  }));

  await RawStationModel.bulkWrite(ops as any[], { ordered: false });
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
