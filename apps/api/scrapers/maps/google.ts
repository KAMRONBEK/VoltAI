import dotenv from "dotenv";
import puppeteer from "puppeteer";
import { createStationFromMapCard, upsertRawStations } from "./common";
import { withDatabase } from "../utils/db";

dotenv.config();

const cities = ["Tashkent", "Samarkand", "Bukhara", "Andijan", "Fergana", "Namangan", "Nukus"];

interface CardData {
  name: string;
  url?: string;
}

async function run(): Promise<void> {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const output = new Map<string, ReturnType<typeof createStationFromMapCard>>();

  for (const city of cities) {
    const query = encodeURIComponent(`EV charging station ${city}`);
    await page.goto(`https://www.google.com/maps/search/${query}/`, { waitUntil: "networkidle2" });
    await delay(3000);

    const cards = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a[href*='/maps/place/']")).slice(0, 250);
      return links
        .map((link) => {
          const name = (link.textContent ?? "").trim();
          const href = (link as HTMLAnchorElement).href;
          if (!name || !href) return null;
          return { name, url: href };
        })
        .filter(Boolean) as CardData[];
    });

    for (const card of cards) {
      const coords = extractGoogleCoords(card.url);
      const station = createStationFromMapCard({
        source: "google-maps",
        externalId: `google-${city}-${card.name}`.toLowerCase().replace(/\s+/g, "-"),
        name: card.name,
        lat: coords?.lat,
        lng: coords?.lng,
        rawData: { city, ...card }
      });
      if (station) {
        output.set(station.externalId, station);
      }
    }
  }

  await browser.close();

  await withDatabase(async () => {
    await upsertRawStations(
      Array.from(output.values()).filter(
        (station): station is NonNullable<ReturnType<typeof createStationFromMapCard>> => Boolean(station)
      )
    );
  });
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
