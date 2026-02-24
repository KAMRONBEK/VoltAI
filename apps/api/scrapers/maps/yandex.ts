import crypto from "node:crypto";
import dotenv from "dotenv";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { createStationFromMapCard, upsertRawStations } from "./common";
import { loadCheckpoint, saveCheckpoint } from "./checkpoint";
import { adaptiveRefineCells, cellCenter, generateUzbekistanGrid, shardCells, type GeoCell } from "./grid";
import { MAP_KEYWORDS } from "./keywords";
import { assertCoverageQuality, createMetrics, saveMetrics } from "./metrics";
import { jitterDelay, randomUserAgent, withRetry } from "./runtime";
import { withDatabase } from "../utils/db";

dotenv.config();

interface Candidate {
  name: string;
  url: string;
}

async function run(): Promise<void> {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const detailPage = await browser.newPage();
  await page.setUserAgent(randomUserAgent());
  await detailPage.setUserAgent(randomUserAgent(2));

  const checkpoint = await loadCheckpoint("yandex");
  const completed = new Set(checkpoint.completed);
  const metrics = createMetrics("yandex");
  const output = new Map<string, ReturnType<typeof createStationFromMapCard>>();
  const coordCache = new Map<string, { lat: number; lng: number } | null>();

  const initialCells = shardByEnv(generateUzbekistanGrid(0.35, 0.35));
  const refined = await adaptiveRefineCells(
    initialCells,
    async (cell) => estimateCellDensity(cell, page, MAP_KEYWORDS[0]),
    { maxDepth: 2, splitThreshold: 35 }
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
        baseDelayMs: 1200
      });
      metrics.discoveredCards += candidates.length;

      for (const candidate of candidates) {
        const details = await resolveYandexDetails(candidate, coordCache, detailPage);
        metrics.detailPagesFetched += 1;
        if (details.coords) {
          metrics.validCoordinates += 1;
        }
        const station = createStationFromMapCard({
          source: "yandex-maps",
          externalId: `yandex-${hashExternalId(candidate.url, cell.id, keyword)}`,
          name: details.name ?? candidate.name,
          address: details.address,
          lat: details.coords?.lat,
          lng: details.coords?.lng,
          rawData: {
            provider: "yandex",
            placeUrl: candidate.url,
            query: keyword,
            cellId: cell.id,
            description: details.description,
            images: details.images,
            providerPlaceId: extractYandexPlaceId(candidate.url)
          }
        });
        if (station) {
          output.set(station.externalId, station);
        }
      }

      completed.add(token);
      await saveCheckpoint("yandex", completed);
      await jitterDelay(600, 500);
    }
    // eslint-disable-next-line no-console
    console.log(`[yandex] cell=${cell.id} stationsAccum=${output.size}`);
  }

  await browser.close();

  if (output.size === 0) {
    throw new Error("[yandex] Parsed 0 stations after full crawl.");
  }

  await withDatabase(async () => {
    const stations = Array.from(output.values()).filter(
      (station): station is NonNullable<ReturnType<typeof createStationFromMapCard>> => Boolean(station)
    );
    await upsertRawStations(stations);
    metrics.insertedRawStations = stations.length;
  });

  metrics.endedAt = new Date().toISOString();
  await saveMetrics(metrics);
  assertCoverageQuality(metrics);
  // eslint-disable-next-line no-console
  console.log(`[yandex] upserted=${metrics.insertedRawStations}`);
}

async function estimateCellDensity(cell: GeoCell, page: Page, keyword: string): Promise<number> {
  return withRetry(
    async () => {
      const center = cellCenter(cell);
      const url = `https://yandex.uz/maps/?ll=${center.lng}%2C${center.lat}&z=11&text=${encodeURIComponent(keyword)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await jitterDelay(1200, 800);
      return page.evaluate(() => Array.from(document.querySelectorAll("a[href*='/maps/org/']")).length);
    },
    {
      retries: 2,
      baseDelayMs: 1200
    }
  );
}

async function collectCandidates(page: Page, cell: GeoCell, keyword: string): Promise<Candidate[]> {
  const center = cellCenter(cell);
  const query = encodeURIComponent(keyword);
  const url = `https://yandex.uz/maps/?ll=${center.lng}%2C${center.lat}&z=12&text=${query}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40_000 });
  await jitterDelay(1800, 800);

  const seen = new Map<string, Candidate>();
  let staleRounds = 0;

  for (let round = 0; round < 14; round += 1) {
    const items = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a[href*='/maps/org/']"));
      return links
        .map((link) => {
          const href = (link as HTMLAnchorElement).href;
          const name = (link.textContent ?? "").trim();
          if (!href || !name) return null;
          return { url: href, name };
        })
        .filter((item): item is { url: string; name: string } => item !== null);
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
    if (staleRounds >= 3) {
      break;
    }

    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
    await jitterDelay(900, 600);
  }

  return Array.from(seen.values());
}

async function resolveYandexDetails(
  candidate: Candidate,
  cache: Map<string, { lat: number; lng: number } | null>,
  detailPage: Page
): Promise<{
  name?: string;
  address?: string;
  description?: string;
  images: string[];
  coords: { lat: number; lng: number } | null;
}> {
  if (cache.has(candidate.url)) {
    return {
      name: candidate.name,
      images: [],
      coords: cache.get(candidate.url) ?? null
    };
  }

  try {
    await detailPage.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: 35_000 });
    await jitterDelay(500, 300);
    const html = await detailPage.content();
    const coords = extractCoordsFromHtml(html) ?? extractYandexCoords(candidate.url);
    cache.set(candidate.url, coords);

    const name = extractMetaContent(html, "og:title") ?? candidate.name;
    const description = extractMetaContent(html, "og:description");
    const address = extractAddress(html);
    const images = extractImageUrls(html);

    return { name, address, description, images, coords };
  } catch {
    const coords = extractYandexCoords(candidate.url);
    cache.set(candidate.url, coords);
    return { name: candidate.name, images: [], coords };
  }
}

function extractCoordsFromHtml(html: string): { lat: number; lng: number } | null {
  const match = html.match(/"coordinates"\s*:\s*\[\s*([0-9.\-]+)\s*,\s*([0-9.\-]+)\s*\]/i);
  if (!match) {
    return null;
  }
  const lng = Number(match[1]);
  const lat = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function extractYandexCoords(url?: string): { lat: number; lng: number } | null {
  if (!url) return null;
  const llMatch = /ll=([0-9.\-]+)(?:%2C|,)([0-9.\-]+)/.exec(url);
  if (llMatch) {
    const lng = Number(llMatch[1]);
    const lat = Number(llMatch[2]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  const pointMatch = /pt=([0-9.\-]+),([0-9.\-]+)/.exec(url);
  if (pointMatch) {
    const lng = Number(pointMatch[1]);
    const lat = Number(pointMatch[2]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  return null;
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
  const match = html.match(/"fullAddress"\s*:\s*"([^"]+)"/i);
  return match?.[1]?.trim();
}

function extractImageUrls(html: string): string[] {
  const matches = html.match(/https:\/\/[^"'\s]+(?:jpg|jpeg|png|webp)/gi) ?? [];
  return Array.from(new Set(matches)).slice(0, 5);
}

function extractYandexPlaceId(url: string): string | undefined {
  const match = url.match(/\/maps\/org\/[^/]*\/(\d+)/);
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
