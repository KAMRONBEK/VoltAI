import cron from "node-cron";
import app from "./app";
import { connectDatabase } from "./db/sqlite";
import { mergeStations } from "./services/mergeService";
import { scrapeAllHttpSources } from "../scrapers/http/httpScraper";
import { upsertRawStations } from "./repositories/rawStationRepo";
import { setMeta } from "./repositories/metaRepo";

const port = Number(process.env.PORT ?? 3000);

async function start(): Promise<void> {
  await connectDatabase();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`VoltAI API listening on port ${port}`);
  });

  scheduleScrape();
  scheduleMerge();

  // Populate immediately on boot so a fresh phone/deploy serves real data at once.
  if (scrapeEnabled()) {
    void refresh("startup");
  }
}

function scrapeEnabled(): boolean {
  return process.env.SCRAPE_ENABLED !== "false";
}

let refreshing = false;

/**
 * Pull every HTTP-enabled operator source, upsert the raw captures, then rebuild
 * the canonical table. Guarded so overlapping ticks (or startup + cron) never run
 * concurrently — node-sqlite3-wasm is single-process.
 */
async function refresh(trigger: string): Promise<void> {
  if (refreshing) {
    return;
  }
  refreshing = true;
  try {
    const results = await scrapeAllHttpSources();
    let total = 0;
    for (const result of results) {
      if (result.ok && result.stations.length) {
        upsertRawStations(result.stations);
        setMeta(`lastIngestAt:${result.source}`, new Date().toISOString());
        total += result.stations.length;
        // eslint-disable-next-line no-console
        console.log(`[scrape:${trigger}] ${result.source}: ${result.stations.length} raw stations`);
      } else if (!result.ok) {
        // eslint-disable-next-line no-console
        console.error(`[scrape:${trigger}] ${result.source} failed: ${result.error}`);
      }
    }

    const { mergedCount } = await mergeStations();
    setMeta("lastMergeAt", new Date().toISOString());
    // eslint-disable-next-line no-console
    console.log(`[scrape:${trigger}] ${total} raw → ${mergedCount} canonical stations`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[scrape:${trigger}] failed`, error);
  } finally {
    refreshing = false;
  }
}

/** Periodically re-scrape the operator APIs and rebuild the canonical table. */
function scheduleScrape(): void {
  if (!scrapeEnabled()) {
    // eslint-disable-next-line no-console
    console.log("[scrape] disabled (SCRAPE_ENABLED=false)");
    return;
  }
  const expression = process.env.SCRAPE_CRON ?? "*/10 * * * *";
  cron.schedule(expression, () => {
    void refresh("cron");
  });
}

/** Rebuild the canonical `stations` table from raw captures on a schedule. */
function scheduleMerge(): void {
  const expression = process.env.MERGE_CRON ?? "*/15 * * * *";
  let merging = false;

  cron.schedule(expression, async () => {
    if (merging || refreshing) {
      return;
    }
    merging = true;
    try {
      const { mergedCount } = await mergeStations();
      setMeta("lastMergeAt", new Date().toISOString());
      // eslint-disable-next-line no-console
      console.log(`[merge] ${mergedCount} canonical stations`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[merge] failed", error);
    } finally {
      merging = false;
    }
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  process.exit(1);
});
