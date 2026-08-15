import crypto from "node:crypto";
import "../../src/env";
import puppeteer, { type Page } from "puppeteer";
import { createStationFromMapCard, upsertRawStations } from "./common";
import { loadCheckpoint, saveCheckpoint } from "./checkpoint";
import { adaptiveRefineCells, cellCenter, generateUzbekistanGrid, shardCells, type GeoCell } from "./grid";
import { MAP_KEYWORDS } from "./keywords";
import { assertCoverageQuality, createMetrics, saveMetrics } from "./metrics";
import { jitterDelay, randomUserAgent, withRetry } from "./runtime";
import { withDatabase } from "../utils/db";


interface Candidate {
  name: string;
  url: string;
}

type PersistableStation = NonNullable<ReturnType<typeof createStationFromMapCard>>;

const FLUSH_BATCH_SIZE = Number(process.env.MAP_FLUSH_BATCH_SIZE ?? 120);

async function run(): Promise<void> {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const detailPage = await browser.newPage();
  await page.setUserAgent(randomUserAgent());
  await detailPage.setUserAgent(randomUserAgent(3));

  const checkpoint = await loadCheckpoint("google");
  const completed = new Set(checkpoint.completed);
  const metrics = createMetrics("google");
  const pendingUpserts = new Map<string, PersistableStation>();
  const uniqueStations = new Set<string>();

  const initialCells = shardByEnv(generateUzbekistanGrid(0.35, 0.35));
  const refined = await adaptiveRefineCells(
    initialCells,
    async (cell) => estimateCellDensity(cell, page, MAP_KEYWORDS[0]),
    { maxDepth: 2, splitThreshold: 30 }
  );
  metrics.coverageCells = refined.length;

  for (const cell of refined) {
    for (const keyword of MAP_KEYWORDS) {
      const token = `${cell.id}|${keyword}`;
      if (completed.has(token)) {
        continue;
      }

      const candidates = await withRetry(() => collectCandidates(page, cell, keyword), {
        retries: 2,
        baseDelayMs: 1500
      });
      metrics.discoveredCards += candidates.length;

      for (const candidate of candidates) {
        const details = await resolveGoogleDetails(candidate, detailPage);
        metrics.detailPagesFetched += 1;
        if (details.coords) {
          metrics.validCoordinates += 1;
        }

        const station = createStationFromMapCard({
          source: "google-maps",
          externalId: `google-${hashExternalId(candidate.url, cell.id, keyword)}`,
          name: details.name ?? candidate.name,
          address: details.address,
          lat: details.coords?.lat,
          lng: details.coords?.lng,
          rawData: {
            provider: "google",
            placeUrl: candidate.url,
            query: keyword,
            cellId: cell.id,
            description: details.description,
            images: details.images,
            providerPlaceId: extractGooglePlaceId(candidate.url)
          }
        });
        if (station) {
          pendingUpserts.set(station.externalId, station);
          uniqueStations.add(station.externalId);
          if (pendingUpserts.size >= FLUSH_BATCH_SIZE) {
            await flushPendingStations("google", pendingUpserts);
          }
        }
      }

      completed.add(token);
      await saveCheckpoint("google", completed);
      await jitterDelay(600, 500);
    }
    await flushPendingStations("google", pendingUpserts);
    // eslint-disable-next-line no-console
    console.log(`[google] cell=${cell.id} stationsAccum=${uniqueStations.size}`);
  }

  await flushPendingStations("google", pendingUpserts);
  await browser.close();

  if (uniqueStations.size === 0) {
    throw new Error("[google] Parsed 0 stations after full crawl.");
  }

  metrics.insertedRawStations = uniqueStations.size;

  metrics.endedAt = new Date().toISOString();
  await saveMetrics(metrics);
  assertCoverageQuality(metrics);
  // eslint-disable-next-line no-console
  console.log(`[google] upserted=${metrics.insertedRawStations}`);
}

async function flushPendingStations(
  provider: "google",
  pendingUpserts: Map<string, PersistableStation>
): Promise<void> {
  if (pendingUpserts.size === 0) {
    return;
  }

  const stations = Array.from(pendingUpserts.values());
  await withDatabase(async () => {
    await upsertRawStations(stations);
  });
  pendingUpserts.clear();
  // eslint-disable-next-line no-console
  console.log(`[${provider}] flushed=${stations.length}`);
}

async function estimateCellDensity(cell: GeoCell, page: Page, keyword: string): Promise<number> {
  return withRetry(
    async () => {
      const center = cellCenter(cell);
      const query = encodeURIComponent(`${keyword} near ${center.lat},${center.lng}`);
      await page.goto(`https://www.google.com/maps/search/${query}/`, {
        waitUntil: "domcontentloaded",
        timeout: 35_000
      });
      await jitterDelay(1500, 700);
      return page.evaluate(() => Array.from(document.querySelectorAll("a[href*='/maps/place/']")).length);
    },
    {
      retries: 2,
      baseDelayMs: 1500
    }
  );
}

async function collectCandidates(page: Page, cell: GeoCell, keyword: string): Promise<Candidate[]> {
  const center = cellCenter(cell);
  const query = encodeURIComponent(`${keyword} near ${center.lat},${center.lng}`);
  await page.goto(`https://www.google.com/maps/search/${query}/`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000
  });
  await jitterDelay(2000, 900);

  const seen = new Map<string, Candidate>();
  let staleRounds = 0;

  for (let round = 0; round < 16; round += 1) {
    const items = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a[href*='/maps/place/']"));
      return links
        .map((link) => {
          const url = (link as HTMLAnchorElement).href;
          const name = (link.textContent ?? "").trim();
          if (!url || !name) return null;
          return { name, url };
        })
        .filter((item): item is { name: string; url: string } => item !== null);
    });

    const before = seen.size;
    for (const item of items) {
      seen.set(item.url, item);
    }

    if (seen.size === before) {
      staleRounds += 1;
    } else {
      staleRounds = 0;
    }
    if (staleRounds >= 4) {
      break;
    }

    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await jitterDelay(850, 500);
  }

  return Array.from(seen.values());
}

async function resolveGoogleDetails(
  candidate: Candidate,
  detailPage: Page
): Promise<{
  name?: string;
  address?: string;
  description?: string;
  images: string[];
  coords: { lat: number; lng: number } | null;
}> {
  try {
    await detailPage.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: 35_000 });
    await jitterDelay(600, 350);
    const html = await detailPage.content();
    const coords = extractGoogleCoords(candidate.url) ?? extractGoogleCoordsFromHtml(html);
    const name = extractMetaContent(html, "og:title") ?? candidate.name;
    const description = extractMetaContent(html, "og:description");
    const address = extractAddress(html);
    const images = extractImageUrls(html);
    return { name, address, description, images, coords };
  } catch {
    return {
      name: candidate.name,
      images: [],
      coords: extractGoogleCoords(candidate.url)
    };
  }
}

function extractGoogleCoords(url?: string): { lat: number; lng: number } | null {
  if (!url) return null;
  const match = /@([0-9.\-]+),([0-9.\-]+)/.exec(url);
  if (!match) {
    return null;
  }
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function extractGoogleCoordsFromHtml(html: string): { lat: number; lng: number } | null {
  const match = html.match(/"center"\s*:\s*\[\s*([0-9.\-]+)\s*,\s*([0-9.\-]+)\s*\]/i);
  if (!match) {
    return null;
  }
  const lng = Number(match[1]);
  const lat = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function extractMetaContent(html: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const match = html.match(regex);
  return match?.[1]?.trim();
}

function extractAddress(html: string): string | undefined {
  const match = html.match(/"formattedAddress"\s*:\s*"([^"]+)"/i);
  return match?.[1]?.trim();
}

function extractImageUrls(html: string): string[] {
  const matches = html.match(/https:\/\/[^"'\s]+(?:jpg|jpeg|png|webp)/gi) ?? [];
  return Array.from(new Set(matches)).slice(0, 5);
}

function extractGooglePlaceId(url: string): string | undefined {
  const match = url.match(/!1s([^!]+)/);
  return match?.[1];
}

function hashExternalId(url: string, cellId: string, query: string): string {
  return crypto.createHash("sha1").update(`${url}|${cellId}|${query}`).digest("hex").slice(0, 16);
}

function shardByEnv(cells: GeoCell[]): GeoCell[] {
  const shardIndex = Number(process.env.MAP_SHARD_INDEX ?? 0);
  const shardTotal = Number(process.env.MAP_SHARD_TOTAL ?? 1);
  return shardCells(cells, shardIndex, shardTotal);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
