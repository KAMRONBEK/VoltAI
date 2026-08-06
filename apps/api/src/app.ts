import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import stationsRouter from "./routes/stations";
import ingestRouter from "./routes/ingest";
import { connectDatabase } from "./db/sqlite";
import { countStations } from "./repositories/stationRepo";
import { countRawStations } from "./repositories/rawStationRepo";
import { getMeta } from "./repositories/metaRepo";
import { appScraperConfigs } from "../scrapers/apps";

dotenv.config();

const app = express();

const corsOrigins = (process.env.CORS_ORIGINS ?? "")
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

app.use(express.json({ limit: "12mb" }));
app.use(async (_req, _res, next) => {
  try {
    await connectDatabase();
    next();
  } catch (error) {
    next(error);
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Data-freshness detail — HTTP liveness alone says nothing about whether capture is working.
// `secondsSinceLastScrape` + `stale` let an external monitor (or the on-device watchdog) catch
// a scheduler that has silently stopped ticking even though the process is still answering.
app.get("/api/health/detail", (_req, res) => {
  const staleAfterSec = Number(process.env.STATIONS_STALE_AFTER_SEC ?? 900);
  const lastScrapeAt = getMeta("lastScrapeAt");
  const secondsSinceLastScrape = lastScrapeAt
    ? Math.floor((Date.now() - Date.parse(lastScrapeAt)) / 1000)
    : null;
  res.json({
    status: "ok",
    uptimeSec: Math.floor(process.uptime()),
    rss: process.memoryUsage().rss,
    stations: countStations(),
    rawStations: countRawStations(),
    lastScrapeAt,
    lastScrapeStartAt: getMeta("lastScrapeStartAt"),
    secondsSinceLastScrape,
    stale: secondsSinceLastScrape != null && secondsSinceLastScrape > staleAfterSec,
    lastMergeAt: getMeta("lastMergeAt"),
    lastIngestAt: Object.fromEntries(
      Object.keys(appScraperConfigs).map((source) => [source, getMeta(`lastIngestAt:${source}`)])
    )
  });
});

app.use("/api/stations", stationsRouter);

// Loopback-only in production (must not be exposed through the tunnel); token-guarded.
app.use("/ingest", ingestRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "Unexpected error";
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ message });
});

export default app;
