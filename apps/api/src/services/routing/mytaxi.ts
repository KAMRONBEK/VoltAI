/**
 * Road-routing client (MyTaxi proxy), with the guard rails a single-phone origin needs.
 *
 * We depend on a third-party endpoint whose rate limits are undocumented and whose availability
 * we do not control, from a backend that is one phone. So every call is: cached for a long time,
 * rate-limited by us before they rate-limit us, wrapped in a breaker so an outage costs one
 * timeout rather than one timeout per request, and single-flighted so a thundering herd of
 * identical plans produces exactly one upstream call.
 *
 * Nothing the provider returns is trusted until it has been checked against the question we
 * asked: a 'success' body whose polyline does not start near `from`, end near `to` and measure
 * roughly `distance` is a wrong answer, and a wrong answer that gets cached for 90 days is worse
 * than no answer at all — every plan on that pair would inherit it.
 *
 * Uses global fetch rather than axios: no extra dependency on the request path, and the same code
 * works unchanged in Hermes when this moves into the app.
 */

import { getDb } from "../../db/sqlite";
import { envInt, envOpt, envStr } from "../../env";
import { decodePolyline, haversineKm } from "../planner/corridor";

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

// All via env.ts helpers: a blank `MYTAXI_TIMEOUT_MS=` in .env must mean "default", never "0 ms".
const BASE_URL = envStr("MYTAXI_BASE_URL", "https://proxy.mytaxi.uz/v1");
/** Floor of 500 ms — anything shorter is a self-inflicted outage on a mobile uplink. */
const TIMEOUT_MS = envInt("MYTAXI_TIMEOUT_MS", 2500, { min: 500 });

/** Cache lifetime. Roads are stable; the point of this number is to make repeats free. */
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Our own limits, deliberately below anything the provider is likely to enforce. */
const BUCKET_PER_MIN = envInt("MYTAXI_RATE_PER_MIN", 20, { min: 1 });
const BUCKET_PER_DAY = envInt("MYTAXI_RATE_PER_DAY", 400, { min: 1 });

/** Consecutive failures before the breaker opens, and how long it stays open. */
const BREAKER_THRESHOLD = 3;
const BREAKER_OPEN_MS = 5 * 60 * 1000;

/**
 * Negative cache: how long a per-key provider verdict of "no" (4xx or malformed body) is
 * remembered. These are answers about the *pair* — unroutable points, a body we could not
 * validate — so retrying them within minutes just spends provider budget on the same "no".
 * Deliberately short: a provider hiccup that returned garbage must not pin a pair for a day.
 */
const NEGATIVE_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_MAX_ENTRIES = 500;

/**
 * Geometry validation tolerances.
 *
 * ENDPOINT_TOLERANCE_KM: the provider snaps to the nearest routable road, so the first/last vertex
 * can sit a long way from a raw pin dropped in open country — the production cache holds a real
 * row whose origin (40.778,68.333, steppe north-west of Gulistan) was snapped 13.6 km. 25 km
 * accepts every such snap seen while still being ~1/10th of the distance between any two cities
 * a plan is likely to run between, so a polyline for the wrong pair (or a swapped lat/lng, or the
 * 16 000 km "route" to Ushuaia that was once cached) still fails.
 *
 * LENGTH_TOLERANCE: the decoded polyline is a chord sum at 1e-5 degree precision, so it should be
 * marginally SHORTER than the provider's odometer distance (measured on the recorded
 * Tashkent -> Qarshi fixture: 453.9 km decoded vs 454.2 km reported, 0.07 % low). ±15 % is two
 * orders of magnitude looser than that, so it never fires on real geometry, and still catches the
 * failures that matter — a truncated line, a distance in the wrong unit, or the polyline of some
 * other request. The 1 km absolute slack keeps very short trips (from ≈ to) from tripping the
 * relative test on rounding alone.
 */
const ENDPOINT_TOLERANCE_KM = 25;
const LENGTH_TOLERANCE = 0.15;
const LENGTH_SLACK_KM = 1;

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

/** Per-key negative verdicts (see NEGATIVE_TTL_MS). Insertion-ordered, so eviction is FIFO. */
const negative = new Map<string, { until: number; result: RoutingFailure }>();

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

/** Inverse of routeCacheKey, so a cached row can be checked against the question it answers. */
export function parseRouteCacheKey(key: string): { from: LatLng; to: LatLng } | null {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)->(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(key);
  if (!m) return null;
  const from = { lat: Number(m[1]), lng: Number(m[2]) };
  const to = { lat: Number(m[3]), lng: Number(m[4]) };
  if (![from.lat, from.lng, to.lat, to.lng].every(Number.isFinite)) return null;
  return { from, to };
}

/**
 * Does this geometry answer the question (from -> to, distanceM)? Pure; used both on the fresh
 * provider body and on every cache read, so a bad row written by an older build cannot survive.
 */
export function validateGeometry(
  from: LatLng,
  to: LatLng,
  polyline: string,
  distanceM: number
): { ok: true } | { ok: false; detail: string } {
  if (!Number.isFinite(distanceM) || distanceM <= 0) {
    return { ok: false, detail: `distance ${distanceM} is not a positive number` };
  }
  let points: LatLng[];
  try {
    points = decodePolyline(polyline);
  } catch (error) {
    return { ok: false, detail: `polyline did not decode: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (points.length < 2) return { ok: false, detail: `polyline decoded to ${points.length} point(s)` };
  if (!points.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)) {
    return { ok: false, detail: "polyline contains out-of-range coordinates" };
  }

  const startKm = haversineKm(from, points[0]);
  if (startKm > ENDPOINT_TOLERANCE_KM) {
    return { ok: false, detail: `polyline starts ${startKm.toFixed(1)} km from origin` };
  }
  const endKm = haversineKm(to, points[points.length - 1]);
  if (endKm > ENDPOINT_TOLERANCE_KM) {
    return { ok: false, detail: `polyline ends ${endKm.toFixed(1)} km from destination` };
  }

  let decodedKm = 0;
  for (let i = 1; i < points.length; i++) decodedKm += haversineKm(points[i - 1], points[i]);
  const reportedKm = distanceM / 1000;
  const allowedKm = Math.max(LENGTH_TOLERANCE * reportedKm, LENGTH_SLACK_KM);
  if (Math.abs(decodedKm - reportedKm) > allowedKm) {
    return {
      ok: false,
      detail: `polyline measures ${decodedKm.toFixed(1)} km but provider reported ${reportedKm.toFixed(1)} km`,
    };
  }
  return { ok: true };
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

/**
 * Cache read. Rows are re-validated against their own key on the way out — a row that fails is
 * deleted and treated as a miss, so one bad write (older build, provider glitch) costs one
 * re-fetch rather than 90 days of wrong plans.
 */
export function readCachedRoute(key: string): RouteGeometry | null {
  const rows = getDb().all("SELECT distance_m, polyline, fetched_at FROM route_cache WHERE k = ?", [
    key,
  ]) as Record<string, any>[];
  const row = rows[0];
  if (!row) return null;
  const age = Date.now() - Date.parse(String(row.fetched_at));
  if (!Number.isFinite(age) || age > CACHE_TTL_MS) return null;

  const polyline = String(row.polyline);
  const distanceM = Number(row.distance_m);
  const ends = parseRouteCacheKey(key);
  const verdict = ends ? validateGeometry(ends.from, ends.to, polyline, distanceM) : { ok: false as const, detail: "unparseable key" };
  if (!verdict.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[routing] dropping bad cached route ${key}: ${verdict.detail}`);
    try {
      getDb().run("DELETE FROM route_cache WHERE k = ?", [key]);
    } catch (error) {
      // Cache maintenance must never turn a degradable routing lookup into a 500.
      // eslint-disable-next-line no-console
      console.warn("[routing] could not drop bad cached route", error);
    }
    return null;
  }
  return { polyline, distanceM, source: "cache" };
}

function writeCachedRoute(key: string, provider: string, geo: RouteGeometry): void {
  try {
    getDb().run(
      `INSERT OR REPLACE INTO route_cache (k, provider, distance_m, polyline, fetched_at)
       VALUES (?,?,?,?,?)`,
      [key, provider, geo.distanceM, geo.polyline, new Date().toISOString()]
    );
  } catch (error) {
    // A busy DB (merge in progress) must not discard a good provider answer — just skip caching.
    // eslint-disable-next-line no-console
    console.warn("[routing] could not cache route", error);
  }
}

/** Cursor for the bounded validation scan in pruneRouteCache — walks the table in key order. */
let pruneCursor = "";
const PRUNE_SCAN_ROWS = 100;

/**
 * Housekeeping, called once per scrape cycle from index.ts. Returns rows deleted.
 *
 * Two jobs: (1) expire rows older than the TTL — readCachedRoute already ignores them, this just
 * reclaims the space; (2) re-validate a bounded slice of the remaining rows against their key so
 * geometry written before validation existed is weeded out over a few cycles without ever
 * decoding the whole table in one go on a phone CPU. The cursor wraps, so every row is eventually
 * visited; rows are also validated on read, so this is belt-and-braces, not the only defence.
 */
export function pruneRouteCache(): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
  let deleted = db.run("DELETE FROM route_cache WHERE fetched_at < ?", [cutoff]).changes;

  const rows = db.all(
    "SELECT k, distance_m, polyline FROM route_cache WHERE k > ? ORDER BY k LIMIT ?",
    [pruneCursor, PRUNE_SCAN_ROWS]
  ) as Record<string, any>[];
  // Fewer than a full page means we reached the end: wrap so the next call starts over.
  pruneCursor = rows.length < PRUNE_SCAN_ROWS ? "" : String(rows[rows.length - 1].k);

  for (const row of rows) {
    const key = String(row.k);
    const ends = parseRouteCacheKey(key);
    const verdict = ends
      ? validateGeometry(ends.from, ends.to, String(row.polyline), Number(row.distance_m))
      : { ok: false as const, detail: "unparseable key" };
    if (!verdict.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[routing] pruning bad cached route ${key}: ${verdict.detail}`);
      deleted += db.run("DELETE FROM route_cache WHERE k = ?", [key]).changes;
    }
  }
  return deleted;
}

function readNegative(key: string, now: number): RoutingFailure | null {
  const hit = negative.get(key);
  if (!hit) return null;
  if (hit.until <= now) {
    negative.delete(key);
    return null;
  }
  return hit.result;
}

function writeNegative(key: string, result: RoutingFailure, now: number): void {
  // Bounded: drop the oldest entries rather than let a scan of random pairs grow the map forever.
  while (negative.size >= NEGATIVE_MAX_ENTRIES) {
    const oldest = negative.keys().next().value;
    if (oldest === undefined) break;
    negative.delete(oldest);
  }
  negative.set(key, { until: now + NEGATIVE_TTL_MS, result });
}

/**
 * One provider call. The result carries `cacheable`, which is only true when the geometry
 * validated, and `negative`, which is true when the answer was a definitive "no" for this pair.
 */
async function fetchFromProvider(
  from: LatLng,
  to: LatLng
): Promise<{ result: RoutingResult; negative: boolean }> {
  const apiKey = envOpt("MYTAXI_API_KEY");
  if (!apiKey) return { result: { ok: false, reason: "disabled", detail: "MYTAXI_API_KEY not set" }, negative: false };

  const now = Date.now();
  if (now < breakerOpenUntil) {
    return {
      result: { ok: false, reason: "breaker", detail: `open for ${Math.ceil((breakerOpenUntil - now) / 1000)}s` },
      negative: false,
    };
  }
  if (!takeToken(now)) {
    return {
      result: { ok: false, reason: "budget", detail: `${bucket.minuteCount}/min ${bucket.dayCount}/day` },
      negative: false,
    };
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
      // Only the provider being *down* opens the breaker. A 4xx is a verdict on this request
      // (unroutable pair, bad key) — the provider is up, and tripping the breaker on it would turn
      // three odd requests into five minutes of "estimated" for everyone. 429 is not remembered
      // per key either: it says nothing about the pair, only about the moment.
      if (res.status >= 500) recordFailure();
      const negativeVerdict = res.status >= 400 && res.status < 500 && res.status !== 429;
      return { result: { ok: false, reason: "http", detail: `HTTP ${res.status}` }, negative: negativeVerdict };
    }
    let body: {
      status?: string;
      data?: { distance?: number; polyline?: string; eta?: number };
    };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // 200 with a non-JSON body (captive portal, challenge page): the provider is reachable, so
      // this is a malformed answer for the pair, not an outage — no breaker strike.
      return { result: { ok: false, reason: "malformed", detail: "non-JSON body" }, negative: true };
    }
    const distanceM = body?.data?.distance;
    const polyline = body?.data?.polyline;
    if (body?.status !== "success" || typeof distanceM !== "number" || typeof polyline !== "string") {
      // The provider answered, in a shape we do not understand. Not a breaker event (it is up),
      // but remembered per key so a repeat does not spend budget on the same body.
      return {
        result: { ok: false, reason: "malformed", detail: JSON.stringify(body).slice(0, 200) },
        negative: true,
      };
    }

    // A 'success' body is still checked against the question asked; see validateGeometry.
    const verdict = validateGeometry(from, to, polyline, distanceM);
    if (!verdict.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[routing] provider geometry rejected for ${routeCacheKey(from, to)}: ${verdict.detail}`);
      return { result: { ok: false, reason: "malformed", detail: verdict.detail }, negative: true };
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
    return { result: { ok: true, polyline, distanceM, source: "provider" }, negative: false };
  } catch (error) {
    // Network errors and timeouts: the provider is unreachable, which is what the breaker is for.
    recordFailure();
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      result: {
        ok: false,
        reason: aborted ? "timeout" : "http",
        detail: error instanceof Error ? error.message : String(error),
      },
      negative: false,
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

  const remembered = readNegative(key, Date.now());
  if (remembered) return remembered;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<RoutingResult> => {
    const { result, negative: negativeVerdict } = await fetchFromProvider(from, to);
    // Only validated geometry is written: everything below the `ok` branch was rejected above.
    if (result.ok) writeCachedRoute(key, "mytaxi", result);
    else if (negativeVerdict) writeNegative(key, result, Date.now());
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
    configured: Boolean(envOpt("MYTAXI_API_KEY")),
    breakerOpen: now < breakerOpenUntil,
    breakerOpensInSec: now < breakerOpenUntil ? Math.ceil((breakerOpenUntil - now) / 1000) : 0,
    consecutiveFailures,
    minuteUsed: bucket.minuteCount,
    minuteLimit: BUCKET_PER_MIN,
    dayUsed: bucket.dayCount,
    dayLimit: BUCKET_PER_DAY,
    cachedRoutes: Number(rows[0]?.c ?? 0),
    negativeCached: negative.size,
  };
}
