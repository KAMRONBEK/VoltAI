import type { RawStationInput, SourceId } from "../../src/types/station";
import type { AppSelectors } from "../appium/loginFlow";

export interface AppScraperConfig {
  sourceId: SourceId;
  packageName: string;
  launchActivity: string;
  selectors: AppSelectors;
  grizzlyServiceCode?: string;
  grizzlyCountryCode?: string;
  parseResponse: (payload: unknown) => RawStationInput[];
}

export function fallbackParseStations(sourceId: SourceId, payload: unknown): RawStationInput[] {
  const rows = extractArrays(payload);
  const stations: RawStationInput[] = [];

  for (const item of rows) {
    const record = item as Record<string, unknown>;
    const lat = pickNumber(record, ["lat", "latitude", "y"]);
    const lng = pickNumber(record, ["lng", "lon", "longitude", "x"]);
    const name = pickString(record, ["name", "title", "stationName"]);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !name) {
      continue;
    }

    const externalId =
      pickString(record, ["id", "stationId", "uuid"]) ??
      `${sourceId}-${name}-${lat}-${lng}`.toLowerCase().replace(/\s+/g, "-");

    stations.push({
      source: sourceId,
      externalId,
      name,
      address: pickString(record, ["address", "location", "description"]),
      location: { type: "Point", coordinates: [lng, lat] },
      rawData: record,
      scrapedAt: new Date()
    });
  }

  return stations;
}

function extractArrays(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const out: unknown[] = [];
  for (const value of Object.values(payload as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      out.push(...value);
    } else if (value && typeof value === "object") {
      out.push(...extractArrays(value));
    }
  }
  return out;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return Number.NaN;
}
