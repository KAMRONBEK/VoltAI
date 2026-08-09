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
  setMeta("lastScrapeStartAt", new Date().toISOString());
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
      } else if (result.skipped) {
        // eslint-disable-next-line no-console
        console.log(`[scrape:${trigger}] ${result.source} skipped (not logged in)`);
      } else if (!result.ok) {
        // eslint-disable-next-line no-console
        console.error(`[scrape:${trigger}] ${result.source} failed: ${result.error}`);
      }
    }

    const { mergedCount } = await mergeStations();
    // mergeStations() -> replaceAllStations() already recorded lastMergeAt; here we only mark that
    // a full scrape cycle completed — powers the freshness/stale check in /api/health/detail so a
    // stalled scheduler on the phone is detectable.
    setMeta("lastScrapeAt", new Date().toISOString());
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

  // Anti-fingerprinting: a perfectly periodic poll from one account is trivial for an operator
  // API to flag. Instead of a fixed cron, self-reschedule with a random gap in [MIN, MAX] minutes
  // AFTER each scrape COMPLETES — so runs never overlap and never settle into a detectable rhythm.
  const parseMinutes = (raw: string | undefined): number | null => {
    if (raw === undefined) {
      return null;
    }
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  let minMinutes = parseMinutes(process.env.SCRAPE_MIN_MINUTES);
  let maxMinutes = parseMinutes(process.env.SCRAPE_MAX_MINUTES);
  if (minMinutes === null || maxMinutes === null || maxMinutes < minMinutes) {
    minMinutes = 3;
    maxMinutes = 5;
  }

  // eslint-disable-next-line no-console
  console.log(`[scrape] scheduled (randomized ${minMinutes}-${maxMinutes} min between runs)`);

  // A single in-flight timer at any moment; the flag blocks accidental double-scheduling.
  let scheduled = false;
  const scheduleNext = (): void => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    const delayMs = (minMinutes! + Math.random() * (maxMinutes! - minMinutes!)) * 60_000;
    // eslint-disable-next-line no-console
    console.log(`[scrape] next in ${Math.round(delayMs / 1000)}s`);
    setTimeout(() => {
      scheduled = false;
      // Reschedule in finally so a thrown/rejected refresh can never kill the scheduler.
      void refresh("interval")
        .catch(() => undefined)
        .finally(scheduleNext);
    }, delayMs);
  };

  scheduleNext();
}

/** Rebuild the canonical `stations` table from raw captures on a schedule. */
function scheduleMerge(): void {
  // When scraping is on, every scrape cycle already merges at the end, so a standalone merge
  // cron would just repeat identical DELETE/INSERT churn. Only schedule it as a fallback when
  // scraping is disabled (e.g. a read-replica fed purely by /ingest).
  if (scrapeEnabled()) {
    // eslint-disable-next-line no-console
    console.log("[merge] inline with each scrape cycle; standalone merge cron disabled");
    return;
  }
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
