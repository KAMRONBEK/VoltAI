import { Router } from "express";
import {
  getStationById,
  listStations,
  listStationStatuses,
  nearbyStations,
  searchStations,
} from "../repositories/stationRepo";
import { getMeta } from "../repositories/metaRepo";
import { applyCache, envInt, type CachePolicy } from "../utils/httpCache";

const router = Router();

// The canonical catalog (names, coords, connectors) changes slowly, so it can sit warm on the
// edge for a few minutes and still be correct. Tunable via env for the phone deployment.
const LIST_CACHE: CachePolicy = {
  maxAge: envInt("STATIONS_CACHE_MAXAGE", 60),
  sMaxAge: envInt("STATIONS_CACHE_SMAXAGE", 180),
  swr: 600,
  sie: 604800, // serve stale up to 7d if the phone is unreachable
};

// Live statuses change every scrape (5 min), so keep this feed near-real-time. Small payload,
// so a short edge TTL costs the phone almost nothing while giving consumers ~fresh statuses.
const STATUSES_CACHE: CachePolicy = {
  maxAge: envInt("STATUSES_CACHE_MAXAGE", 20),
  sMaxAge: envInt("STATUSES_CACHE_SMAXAGE", 30),
  swr: 60,
  sie: 3600,
};

// How long since the last merge before we flag the data as stale (default 900s = 3x the 5-min cycle).
const STALE_AFTER_SEC = envInt("STATIONS_STALE_AFTER_SEC", 900);

function freshness(): { lastMergeAt: string | null; ageSec: number | null; stale: boolean } {
  const lastMergeAt = getMeta("lastMergeAt");
  const ageSec = lastMergeAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(lastMergeAt)) / 1000))
    : null;
  return { lastMergeAt, ageSec, stale: ageSec != null && ageSec > STALE_AFTER_SEC };
}

router.get("/", (req, res, next) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const q = req.query.q ? String(req.query.q) : undefined;

    const { lastMergeAt } = freshness();
    // Version the cache by merge time + query so a new scrape busts it but identical repeat
    // requests get a cheap 304.
    const tag = `s-${lastMergeAt ?? "0"}-${page}-${limit}-${q ?? ""}`;
    if (applyCache(req, res, LIST_CACHE, { lastModified: lastMergeAt, tag })) return;

    const { items, total } = listStations({ page, limit, q });
    res.json({ page, limit, total, items });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/stations/statuses — compact, near-real-time status feed for other apps.
 * Declared before `/:id` so the literal path wins. Returns overall + per-connector statuses
 * only; pair it with a one-time `/api/stations` fetch for the full catalog.
 */
router.get("/statuses", (req, res, next) => {
  try {
    const { lastMergeAt, ageSec, stale } = freshness();
    // lastMergeAt alone uniquely versions the payload (every merge rewrites the whole table), so
    // answer the 304 BEFORE running the projection — the ~4-of-5 idle polls then skip the query.
    const tag = `st-${lastMergeAt ?? "0"}`;
    if (applyCache(req, res, STATUSES_CACHE, { lastModified: lastMergeAt, tag })) return;

    const items = listStationStatuses();
    res.json({
      generatedAt: new Date().toISOString(),
      lastMergeAt,
      ageSec,
      stale,
      count: items.length,
      stations: items,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/nearby", (req, res, next) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radius = Number(req.query.radius ?? 5000);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ message: "lat and lng query params are required" });
    }

    const { lastMergeAt } = freshness();
    const tag = `nb-${lastMergeAt ?? "0"}-${lat.toFixed(4)}-${lng.toFixed(4)}-${radius}`;
    if (applyCache(req, res, LIST_CACHE, { lastModified: lastMergeAt, tag })) return;

    const items = nearbyStations(lat, lng, radius);
    return res.json({ count: items.length, items });
  } catch (error) {
    return next(error);
  }
});

router.get("/search", (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) {
      return res.status(400).json({ message: "q query param is required" });
    }

    const { lastMergeAt } = freshness();
    const tag = `se-${lastMergeAt ?? "0"}-${q.toLowerCase()}`;
    if (applyCache(req, res, LIST_CACHE, { lastModified: lastMergeAt, tag })) return;

    const items = searchStations(q);
    return res.json({ count: items.length, items });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", (req, res, next) => {
  try {
    const { id } = req.params;
    // Canonical ids are content-derived 24-hex strings (see repositories/objectId.ts).
    if (!/^[0-9a-f]{24}$/.test(id)) {
      return res.status(400).json({ message: "invalid station id" });
    }
    const station = getStationById(id);
    if (!station) {
      return res.status(404).json({ message: "station not found" });
    }
    return res.json(station);
  } catch (error) {
    return next(error);
  }
});

export default router;
