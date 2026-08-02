import fs from "node:fs/promises";
import path from "node:path";

export interface CrawlMetrics {
  provider: "google" | "yandex";
  discoveredCards: number;
  detailPagesFetched: number;
  validCoordinates: number;
  insertedRawStations: number;
  uniqueCanonicalStations?: number;
  coverageCells: number;
  startedAt: string;
  endedAt?: string;
}

export function createMetrics(provider: "google" | "yandex"): CrawlMetrics {
  return {
    provider,
    discoveredCards: 0,
    detailPagesFetched: 0,
    validCoordinates: 0,
    insertedRawStations: 0,
    coverageCells: 0,
    startedAt: new Date().toISOString()
  };
}

export async function saveMetrics(metrics: CrawlMetrics): Promise<void> {
  await fs.mkdir("tmp", { recursive: true });
  const filePath = path.join("tmp", `${metrics.provider}-crawl-metrics.json`);
  await fs.writeFile(filePath, JSON.stringify(metrics, null, 2), "utf8");
}

export function assertCoverageQuality(metrics: CrawlMetrics): void {
  const minRawStations = Number(process.env.QUALITY_MIN_RAW_STATIONS ?? 1000);
  const minCoordinateRate = Number(process.env.QUALITY_MIN_COORD_RATE ?? 0.8);
  const isCi = process.env.CI === "true";

  if (!isCi) {
    return;
  }

  const coordRate =
    metrics.discoveredCards > 0 ? metrics.validCoordinates / metrics.discoveredCards : 0;

  if (metrics.insertedRawStations < minRawStations) {
    throw new Error(
      `[quality] ${metrics.provider}: insertedRawStations=${metrics.insertedRawStations} < ${minRawStations}`
    );
  }

  if (coordRate < minCoordinateRate) {
    throw new Error(
      `[quality] ${metrics.provider}: coordRate=${coordRate.toFixed(2)} < ${minCoordinateRate}`
    );
  }
}
