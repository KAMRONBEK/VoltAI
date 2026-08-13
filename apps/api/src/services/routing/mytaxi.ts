/**
 * Road-routing client (MyTaxi proxy), with the guard rails a single-phone origin needs.
 *
 * We depend on a third-party endpoint whose rate limits are undocumented and whose availability
 * we do not control, from a backend that is one phone. So every call is: cached for a long time,
 * rate-limited by us before they rate-limit us, wrapped in a breaker so an outage costs one
 * timeout rather than one timeout per request, and single-flighted so a thundering herd of
 * identical plans produces exactly one upstream call.
 *
 * Uses global fetch rather than axios: no extra dependency on the request path, and the same code
 * works unchanged in Hermes when this moves into the app.
 */

import { getDb } from "../../db/sqlite";

export interface RouteGeometry {
  polyline: string;
  distanceM: number;
  /** Where the geometry came from — surfaced to the client so it can be honest about accuracy. */
  source: "cache" | "provider";
}

export interface RoutingFailure {
  ok: false;
  reason: "disabled" | "budget" | "breaker" | "timeout" | "http" | "malformed";
  detail?: string;
}

export type RoutingResult = ({ ok: true } & RouteGeometry) | RoutingFailure;

const BASE_URL = process.env.MYTAXI_BASE_URL ?? "https://proxy.mytaxi.uz/v1";
const TIMEOUT_MS = Number(process.env.MYTAXI_TIMEOUT_MS ?? 2500);

/** Cache lifetime. Roads are stable; the point of this number is to make repeats free. */
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Our own limits, deliberately below anything the provider is likely to enforce. */
const BUCKET_PER_MIN = Number(process.env.MYTAXI_RATE_PER_MIN ?? 20);
const BUCKET_PER_DAY = Number(process.env.MYTAXI_RATE_PER_DAY ?? 400);

/** Consecutive failures before the breaker opens, and how long it stays open. */
const BREAKER_THRESHOLD = 3;
const BREAKER_OPEN_MS = 5 * 60 * 1000;

interface BucketState {
  minuteStart: number;
  minuteCount: number;
  dayStart: number;
  dayCount: number;
}

const bucket: BucketState = { minuteStart: 0, minuteCount: 0, dayStart: 0, dayCount: 0 };
let consecutiveFailures = 0;
let breakerOpenUntil = 0;

/** In-flight requests by cache key, so N identical plans cost one upstream call. */
const inFlight = new Map<string, Promise<RoutingResult>>();

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Quantized to 3 dp (~111 m). Two trips that start from opposite ends of the same car park
 * should not each pay for a route, and at intercity scale 111 m is far below the noise floor.
 */
export function routeCacheKey(from: LatLng, to: LatLng): string {
  return `${from.lat.toFixed(3)},${from.lng.toFixed(3)}->${to.lat.toFixed(3)},${to.lng.toFixed(3)}`;
}

function takeToken(now: number): boolean {
  if (now - bucket.minuteStart >= 60_000) {
    bucket.minuteStart = now;
    bucket.minuteCount = 0;
  }
  if (now - bucket.dayStart >= 86_400_000) {
    bucket.dayStart = now;
    bucket.dayCount = 0;
  }
  if (bucket.minuteCount >= BUCKET_PER_MIN || bucket.dayCount >= BUCKET_PER_DAY) return false;
  bucket.minuteCount++;
  bucket.dayCount++;
  return true;
}

export function readCachedRoute(key: string): RouteGeometry | null {
  const rows = getDb().all("SELECT distance_m, polyline, fetched_at FROM route_cache WHERE k = ?", [
    key,
  ]) as Record<string, any>[];
  const row = rows[0];
  if (!row) return null;
  const age = Date.now() - Date.parse(String(row.fetched_at));
  if (!Number.isFinite(age) || age > CACHE_TTL_MS) return null;
  return {
    polyline: String(row.polyline),
    distanceM: Number(row.distance_m),
    source: "cache",
  };
}

function writeCachedRoute(key: string, provider: string, geo: RouteGeometry): void {
  getDb().run(
    `INSERT OR REPLACE INTO route_cache (k, provider, distance_m, polyline, fetched_at)
     VALUES (?,?,?,?,?)`,
    [key, provider, geo.distanceM, geo.polyline, new Date().toISOString()]
  );
}

async function fetchFromProvider(from: LatLng, to: LatLng): Promise<RoutingResult> {
  const apiKey = process.env.MYTAXI_API_KEY;
  if (!apiKey) return { ok: false, reason: "disabled", detail: "MYTAXI_API_KEY not set" };

  const now = Date.now();
  if (now < breakerOpenUntil) {
    return { ok: false, reason: "breaker", detail: `open for ${Math.ceil((breakerOpenUntil - now) / 1000)}s` };
  }
  if (!takeToken(now)) {
    return { ok: false, reason: "budget", detail: `${bucket.minuteCount}/min ${bucket.dayCount}/day` };
  }

  const points = `${from.lat},${from.lng}|${to.lat},${to.lng}`;
  const url = `${BASE_URL}/route?points=${encodeURIComponent(points)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      recordFailure();
      return { ok: false, reason: "http", detail: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as {
      status?: string;
      data?: { distance?: number; polyline?: string; eta?: number };
    };
    const distanceM = body?.data?.distance;
    const polyline = body?.data?.polyline;
    if (body?.status !== "success" || typeof distanceM !== "number" || typeof polyline !== "string") {
      recordFailure();
      return { ok: false, reason: "malformed", detail: JSON.stringify(body).slice(0, 200) };
    }

    // Sanity probe on the provider's ETA. We never use it, but a wildly low implied speed is a
    // signal the upstream changed shape, and it is cheap to notice here rather than in a bug report.
    const eta = body.data?.eta;
    if (typeof eta === "number" && eta > 0 && distanceM > 100_000) {
      const kmh = distanceM / 1000 / (eta / 3600);
      if (kmh < 40) {
        // eslint-disable-next-line no-console
        console.warn(`[routing] provider eta implies ${kmh.toFixed(0)} km/h over ${(distanceM / 1000).toFixed(0)} km — ignoring eta (expected: we model drive time from distance)`);
      }
    }

    consecutiveFailures = 0;
    return { ok: true, polyline, distanceM, source: "provider" };
  } catch (error) {
    recordFailure();
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: aborted ? "timeout" : "http",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= BREAKER_THRESHOLD) {
    breakerOpenUntil = Date.now() + BREAKER_OPEN_MS;
    consecutiveFailures = 0;
    // eslint-disable-next-line no-console
    console.warn(`[routing] breaker opened for ${BREAKER_OPEN_MS / 1000}s after ${BREAKER_THRESHOLD} failures`);
  }
}

/**
 * Route between two points, preferring the cache. Never throws: routing is a degradable
 * dependency, and the planner has a documented fallback when geometry is unavailable.
 */
export async function getRoute(from: LatLng, to: LatLng): Promise<RoutingResult> {
  const key = routeCacheKey(from, to);

  const cached = readCachedRoute(key);
  if (cached) return { ok: true, ...cached };

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<RoutingResult> => {
    const result = await fetchFromProvider(from, to);
    if (result.ok) writeCachedRoute(key, "mytaxi", result);
    return result;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

/** Snapshot for /api/plan/health — makes the breaker and budget observable without a log dive. */
export function routingHealth(): Record<string, unknown> {
  const now = Date.now();
  const rows = getDb().all("SELECT COUNT(*) c FROM route_cache") as Record<string, any>[];
  return {
    configured: Boolean(process.env.MYTAXI_API_KEY),
    breakerOpen: now < breakerOpenUntil,
    breakerOpensInSec: now < breakerOpenUntil ? Math.ceil((breakerOpenUntil - now) / 1000) : 0,
    consecutiveFailures,
    minuteUsed: bucket.minuteCount,
    minuteLimit: BUCKET_PER_MIN,
    dayUsed: bucket.dayCount,
    dayLimit: BUCKET_PER_DAY,
    cachedRoutes: Number(rows[0]?.c ?? 0),
  };
}
