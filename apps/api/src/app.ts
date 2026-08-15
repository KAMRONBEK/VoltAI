import "./env";
import cors from "cors";
import express from "express";
import stationsRouter from "./routes/stations";
import planRouter from "./routes/plan";
import ingestRouter from "./routes/ingest";
import clientConfigRouter from "./routes/clientConfig";
import { connectDatabase } from "./db/sqlite";
import { countStations } from "./repositories/stationRepo";
import { countRawStations } from "./repositories/rawStationRepo";
import { getMeta } from "./repositories/metaRepo";
import { envInt, envStr } from "./env";
import { appScraperConfigs } from "../scrapers/apps";
import { httpEnabledSources } from "../scrapers/http/httpScraper";
import { authStatus, isAuthSource } from "../scrapers/auth";
import { buildInfo } from "./version";
import { resolveDbPath } from "./db/sqlite";
import fs from "node:fs";

const startedAt = new Date().toISOString();

const app = express();

// Behind cloudflared the peer is always loopback; trust the first proxy hop so req.ip reflects
// CF-Connecting-IP-style forwarding for rate limiting/logging.
app.set("trust proxy", "loopback");
app.disable("x-powered-by");

const corsOrigins = envStr("CORS_ORIGINS", "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins.length ? corsOrigins : true
  })
);

// Opt-in request logging (REQUEST_LOG=1) — handy for verifying what the mobile
// app actually calls through the adb-reverse bridge.
if (process.env.REQUEST_LOG === "1") {
  app.use((req, _res, next) => {
    // eslint-disable-next-line no-console
    console.log(`[req] ${req.method} ${req.originalUrl}`);
    next();
  });
}

app.use(async (_req, _res, next) => {
  try {
    await connectDatabase();
    next();
  } catch (error) {
    next(error);
  }
});

/** Liveness: the process answers HTTP. Used by the on-device watchdog — must stay cheap and never
 * fail for data reasons (a restart cannot fix an empty catalog). */
app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ status: "ok", commit: buildInfo().commit });
});

/**
 * Readiness: is this backend actually serving good data? 503 when the catalog is empty, when the
 * DB is not a real file on disk (a blank SQLITE_PATH once ran the phone on a temp DB for days), or
 * when the scrape scheduler is stale. Point the EXTERNAL uptime monitor here, not at /api/health.
 */
app.get("/api/health/ready", (_req, res) => {
  res.set("Cache-Control", "no-store");
  const staleAfterSec = envInt("STATIONS_STALE_AFTER_SEC", 900);
  const lastScrapeAt = getMeta("lastScrapeAt");
  const scrapeAge = lastScrapeAt ? Math.floor((Date.now() - Date.parse(lastScrapeAt)) / 1000) : null;
  const dbPath = resolveDbPath();
  const dbIsFile = (() => {
    try {
      return fs.statSync(dbPath).isFile();
    } catch {
      return false;
    }
  })();
  const stations = countStations();
  const problems: string[] = [];
  if (!dbIsFile) problems.push("database is not a regular file (SQLITE_PATH misconfigured?)");
  if (stations === 0) problems.push("catalog is empty");
  if (scrapeAge != null && scrapeAge > staleAfterSec) problems.push(`last scrape ${scrapeAge}s ago`);
  res.status(problems.length ? 503 : 200).json({
    status: problems.length ? "not-ready" : "ready",
    stations,
    dbPath,
    lastScrapeAt,
    commit: buildInfo().commit,
    problems
  });
});

/**
 * Data-freshness detail — HTTP liveness alone says nothing about whether scraping is working.
 *  - `stale`            the scrape SCHEDULER has stopped ticking (lastScrapeAt too old).
 *  - `sources[*].stale` that operator has not delivered data recently (token expired, API broken,
 *                       parse returned 0 rows) even though the scheduler is fine.
 *  - `auth`             stored-login state per login-replay source, incl. JWT expiry.
 * Alert on `stale` OR any `sources[*].stale`.
 */
app.get("/api/health/detail", (_req, res) => {
  res.set("Cache-Control", "no-store");
  const staleAfterSec = envInt("STATIONS_STALE_AFTER_SEC", 900);
  const now = Date.now();
  const ageSec = (iso: string | null): number | null =>
    iso ? Math.floor((now - Date.parse(iso)) / 1000) : null;

  const lastScrapeAt = getMeta("lastScrapeAt");
  const secondsSinceLastScrape = ageSec(lastScrapeAt);
  const enabled = new Set(httpEnabledSources());
  const auth = authStatus();

  const sources = Object.fromEntries(
    Object.keys(appScraperConfigs).map((source) => {
      const lastIngestAt = getMeta(`lastIngestAt:${source}`);
      const since = ageSec(lastIngestAt);
      const lastCount = getMeta(`lastCount:${source}`);
      const isEnabled = enabled.has(source);
      // A login-replay source with no stored token is deliberately not scraped ("no-login"), so it
      // must not read as a stale/broken source; one with a token that stops delivering does.
      const noLogin = isAuthSource(source) && !auth[source]?.hasToken;
      const state = !isEnabled ? "disabled" : noLogin ? "no-login" : since == null ? "never" : since > staleAfterSec ? "stale" : "fresh";
      return [
        source,
        {
          enabled: isEnabled,
          state,
          lastIngestAt,
          secondsSinceIngest: since,
          lastCount: lastCount ? Number(lastCount) : null,
          lastErrorAt: getMeta(`lastErrorAt:${source}`) || null,
          lastError: getMeta(`lastError:${source}`) || null,
          stale: state === "stale" || state === "never"
        }
      ];
    })
  );

  const dbPath = resolveDbPath();
  let dbFileBytes: number | null = null;
  try {
    dbFileBytes = fs.statSync(dbPath).size;
  } catch {
    dbFileBytes = null;
  }

  res.json({
    status: "ok",
    build: buildInfo(),
    startedAt,
    uptimeSec: Math.floor(process.uptime()),
    rss: process.memoryUsage().rss,
    dbPath,
    dbFileBytes,
    stations: countStations(),
    rawStations: countRawStations(),
    lastScrapeAt,
    lastScrapeStartAt: getMeta("lastScrapeStartAt"),
    secondsSinceLastScrape,
    stale: secondsSinceLastScrape != null && secondsSinceLastScrape > staleAfterSec,
    lastMergeAt: getMeta("lastMergeAt"),
    lastSnapshotAt: getMeta("lastSnapshotAt"),
    // Back-compat: the flat per-source timestamp map older monitors read.
    lastIngestAt: Object.fromEntries(
      Object.keys(appScraperConfigs).map((source) => [source, getMeta(`lastIngestAt:${source}`)])
    ),
    sources,
    auth
  });
});

app.use("/api/stations", stationsRouter);
app.use("/api/client-config", clientConfigRouter);

// Route planning. Read-only and cacheable like /api/stations; must stay ahead of the error
// middleware below.
app.use("/api/plan", planRouter);

/**
 * /ingest — side door for pushing off-device scraper output in. Loopback-only by construction:
 * (1) the API binds 127.0.0.1 by default (src/index.ts), (2) requests that arrived through the
 * Cloudflare tunnel carry `cf-connecting-ip` and are refused here regardless of the ingress rules,
 * (3) the token check inside the router. The JSON body parser is mounted ONLY here — the read API
 * takes no bodies, so nobody can push 12 MB at /api/stations.
 */
app.use(
  "/ingest",
  (req, res, next) => {
    const viaTunnel = Boolean(req.get("cf-connecting-ip") || req.get("cf-ray"));
    const remote = req.socket.remoteAddress ?? "";
    const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    if (viaTunnel || !loopback) {
      return res.status(404).json({ message: "not found" });
    }
    return next();
  },
  express.json({ limit: "12mb" }),
  ingestRouter
);

app.use((req, res) => {
  res.status(404).json({ message: `no route for ${req.method} ${req.path}` });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const anyErr = err as { status?: number; statusCode?: number; message?: string; type?: string };
  const status =
    typeof anyErr?.status === "number" && anyErr.status >= 400 && anyErr.status < 600
      ? anyErr.status
      : typeof anyErr?.statusCode === "number" && anyErr.statusCode >= 400 && anyErr.statusCode < 600
        ? anyErr.statusCode
        : 500;
  // Never let an error response inherit the public cache headers a route set before failing.
  res.removeHeader("Cache-Control");
  res.removeHeader("ETag");
  res.removeHeader("Last-Modified");
  res.set("Cache-Control", "no-store");
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(status).json({ message: "internal error" });
  } else {
    // Client errors (bad JSON, payload too large…) are not worth a stack trace in the phone log.
    res.status(status).json({ message: anyErr?.message ?? "bad request" });
  }
});

export default app;
