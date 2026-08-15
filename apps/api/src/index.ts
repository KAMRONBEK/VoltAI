// Load + normalise env FIRST (dotenv, blank-means-unset) — every other module reads env at import.
import { envBool, envInt, envOpt, envStr, isProduction } from "./env";
import type { Server } from "node:http";
import path from "node:path";
import cron from "node-cron";
import app from "./app";
import { connectDatabase, disconnectDatabase, resolveDbPath, snapshotDatabase } from "./db/sqlite";
import { mergeStations } from "./services/mergeService";
import { scrapeAllHttpSources } from "../scrapers/http/httpScraper";
import { pruneRawStations, upsertRawStations } from "./repositories/rawStationRepo";
import { getMeta, setMeta } from "./repositories/metaRepo";
import { pruneRouteCache } from "./services/routing/mytaxi";
import { authStatus } from "../scrapers/auth";

const port = envInt("PORT", 3000, { min: 1, max: 65535 });
// The tunnel (cloudflared) and the on-device app both talk to loopback, so bind loopback by
// default. Set HOST=0.0.0.0 explicitly to expose the API on the phone's Wi-Fi (e.g. LAN testing).
const host = envStr("HOST", "127.0.0.1");

let server: Server | null = null;

async function start(): Promise<void> {
  await connectDatabase();
  // eslint-disable-next-line no-console
  console.log(`[db] ${resolveDbPath()}`);
  logStartupWarnings();

  server = app.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`VoltAI API listening on http://${host}:${port}`);
  });
  server.on("error", (error) => {
    // EADDRINUSE etc. — exit non-zero so the supervisor restarts us and the log says why.
    // eslint-disable-next-line no-console
    console.error("[http] listen failed", error);
    process.exit(1);
  });

  scheduleScrape();
  scheduleMerge();
  scheduleSnapshot();

  // Populate immediately on boot so a fresh phone/deploy serves real data at once.
  if (scrapeEnabled()) {
    void refresh("startup").catch((error) => {
      // eslint-disable-next-line no-console
      console.error("[scrape:startup] failed", error);
    });
  }
}

/** Loud, actionable warnings for the config mistakes that have actually bitten the phone. */
function logStartupWarnings(): void {
  if (!envOpt("SQLITE_PATH")) {
    // eslint-disable-next-line no-console
    console.warn(`[config] SQLITE_PATH unset — using ${resolveDbPath()} (relative to CWD)`);
  }
  if (isProduction() && !envOpt("MYTAXI_API_KEY")) {
    // eslint-disable-next-line no-console
    console.warn(
      "[config] MYTAXI_API_KEY unset — /api/plan will answer with straight-line 'estimated' geometry only"
    );
  }
  let auth: ReturnType<typeof authStatus> = {};
  try {
    auth = authStatus();
  } catch (error) {
    // A malformed hand-copied token store must never keep the API from booting.
    // eslint-disable-next-line no-console
    console.error("[auth] could not read the token store", error);
  }
  for (const [source, info] of Object.entries(auth)) {
    if (!info.hasToken) {
      // eslint-disable-next-line no-console
      console.warn(`[auth] ${source}: no stored login — run npm run auth:${source} on the dev box, then copy auth-tokens.json`);
    } else if (info.daysLeft != null && info.daysLeft < 30) {
      // eslint-disable-next-line no-console
      console.warn(`[auth] ${source}: token expires in ${info.daysLeft} day(s) (${info.expiresAt}) — re-login soon`);
    }
  }
}

function scrapeEnabled(): boolean {
  return envBool("SCRAPE_ENABLED", true);
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
    // Inside the try: a SQLite error here used to latch `refreshing=true` forever.
    setMeta("lastScrapeStartAt", new Date().toISOString());
    const results = await scrapeAllHttpSources();
    let total = 0;
    let okSources = 0;
    for (const result of results) {
      const now = new Date().toISOString();
      if (result.ok && result.stations.length) {
        upsertRawStations(result.stations);
        setMeta(`lastIngestAt:${result.source}`, now);
        setMeta(`lastCount:${result.source}`, String(result.stations.length));
        // A recovered source must stop advertising its last error.
        setMeta(`lastErrorAt:${result.source}`, "");
        setMeta(`lastError:${result.source}`, "");
        total += result.stations.length;
        okSources += 1;
        // eslint-disable-next-line no-console
        console.log(`[scrape:${trigger}] ${result.source}: ${result.stations.length} raw stations`);
      } else if (result.ok) {
        // 200 but nothing parsed — a WAF/HTML challenge page or a response-shape change. Treated as
        // a failure so the per-source health flips and the operator sees it; nothing is upserted.
        const previous = getMeta(`lastCount:${result.source}`) ?? "?";
        setMeta(`lastErrorAt:${result.source}`, now);
        setMeta(`lastError:${result.source}`, `0 stations parsed (previous run: ${previous})`);
        // eslint-disable-next-line no-console
        console.error(`[scrape:${trigger}] ${result.source}: 0 stations parsed (previous run: ${previous})`);
      } else if (result.skipped) {
        // eslint-disable-next-line no-console
        console.log(`[scrape:${trigger}] ${result.source} skipped: ${result.error}`);
      } else {
        setMeta(`lastErrorAt:${result.source}`, now);
        setMeta(`lastError:${result.source}`, result.error ?? "unknown error");
        // eslint-disable-next-line no-console
        console.error(`[scrape:${trigger}] ${result.source} failed: ${result.error}`);
      }
    }

    const { mergedCount } = await mergeStations();
    // mergeStations() -> replaceAllStations() already recorded lastMergeAt; here we only mark that
    // a full scrape cycle completed — powers the freshness/stale check in /api/health/detail so a
    // stalled scheduler on the phone is detectable. (Per-source freshness lives in lastIngestAt.)
    setMeta("lastScrapeAt", new Date().toISOString());
    // eslint-disable-next-line no-console
    console.log(`[scrape:${trigger}] ${okSources}/${results.length} sources, ${total} raw → ${mergedCount} canonical stations`);

    // Housekeeping (cheap, bounded): forget raw rows no source has reported for a long time so
    // decommissioned chargers do not linger in the merge input forever, and expire old routes.
    const prunedRaw = pruneRawStations(envInt("RAW_RETENTION_DAYS", 30, { min: 1 }));
    const prunedRoutes = pruneRouteCache();
    if (prunedRaw || prunedRoutes) {
      // eslint-disable-next-line no-console
      console.log(`[housekeeping] pruned ${prunedRaw} stale raw rows, ${prunedRoutes} expired routes`);
    }
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
    if (raw === undefined || raw.trim() === "") {
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
    const timer = setTimeout(() => {
      scheduled = false;
      // Reschedule in finally so a thrown/rejected refresh can never kill the scheduler.
      void refresh("interval")
        .catch(() => undefined)
        .finally(scheduleNext);
    }, delayMs);
    timer.unref();
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
  const expression = envStr("MERGE_CRON", "*/15 * * * *");
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

/**
 * Daily consistent DB snapshot (`VACUUM INTO`) for the backup job. The sqlite3 CLI cannot safely
 * copy the live file (its POSIX locks are invisible to the wasm VFS and vice-versa), so the
 * process that owns the database produces the copy and scripts/termux/backup.sh tars THAT.
 * Runs at SNAPSHOT_HOUR local time (default 02:30) and once shortly after boot if today's is
 * missing, so a phone that reboots nightly still gets one.
 */
function scheduleSnapshot(): void {
  if (!envBool("SNAPSHOT_ENABLED", true)) return;
  const dir = envStr("SNAPSHOT_DIR", path.join(path.dirname(resolveDbPath()), "snapshots"));
  const hour = envInt("SNAPSHOT_HOUR", 2, { min: 0, max: 23 });
  const minute = envInt("SNAPSHOT_MINUTE", 30, { min: 0, max: 59 });
  const dest = path.join(dir, "voltai-snapshot.sqlite");

  const run = (reason: string): void => {
    if (refreshing) {
      // Never snapshot mid-merge; try again in a minute.
      setTimeout(() => run(reason), 60_000).unref();
      return;
    }
    try {
      const { bytes } = snapshotDatabase(dest);
      setMeta("lastSnapshotAt", new Date().toISOString());
      // eslint-disable-next-line no-console
      console.log(`[snapshot:${reason}] wrote ${dest} (${Math.round(bytes / 1024)} KB)`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[snapshot:${reason}] failed`, error);
    }
  };

  cron.schedule(`${minute} ${hour} * * *`, () => run("daily"));

  const last = getMeta("lastSnapshotAt");
  const ageMs = last ? Date.now() - Date.parse(last) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(ageMs) || ageMs > 20 * 3600_000) {
    // Give the boot scrape a head start so the first snapshot has data in it.
    setTimeout(() => run("boot"), 5 * 60_000).unref();
  }
}

/**
 * Clean shutdown on the signals runit / Termux send (`sv down`, `sv restart`, reboot): stop
 * accepting connections, close SQLite (releases the on-disk lock directory) and exit 0.
 * Without this every restart was an unclean kill.
 */
function installSignalHandlers(): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[shutdown] ${signal} received — closing`);
    const forceExit = setTimeout(() => process.exit(0), 8000);
    forceExit.unref();
    const finish = (): void => {
      disconnectDatabase()
        .catch(() => undefined)
        .finally(() => process.exit(0));
    };
    if (server) {
      server.close(finish);
      // Do not wait on keep-alive sockets.
      server.closeAllConnections?.();
    } else {
      finish();
    }
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    // eslint-disable-next-line no-console
    console.error("[process] unhandled rejection", reason);
  });
  process.on("uncaughtException", (error) => {
    // eslint-disable-next-line no-console
    console.error("[process] uncaught exception — exiting for a clean restart", error);
    disconnectDatabase()
      .catch(() => undefined)
      .finally(() => process.exit(1));
  });
}

installSignalHandlers();

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  disconnectDatabase()
    .catch(() => undefined)
    .finally(() => process.exit(1));
});
