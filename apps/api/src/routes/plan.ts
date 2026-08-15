/**
 * GET /api/plan — time-optimal EV route with charging stops.
 *
 * GET rather than POST on purpose. The origin is one phone: `applyCache` only implements
 * conditional GET, Cloudflare will not cache a POST, and every retry or back-navigation would
 * otherwise land a fresh computation on that CPU. Making the response a pure function of the
 * query string is what allows the edge to absorb repeats.
 *
 * Request pipeline, cheapest first: per-IP limiter (429) → query validation (400) → concurrency
 * shed (503) → geometry lookup → conditional GET (304) → candidates → solve → 200.
 */

import { Router, type Request } from "express";
import { envInt } from "../env";
import { getMeta } from "../repositories/metaRepo";
import { isRoutablePlug, loadCandidateStations, ROUTABLE_PLUGS } from "../repositories/plannerRepo";
import { Corridor, decodePolyline, haversineKm } from "../services/planner/corridor";
import { planRoute, type Plan, type PlanResult } from "../services/planner/planner";
import { getRoute, routingHealth, type LatLng } from "../services/routing/mytaxi";
import { applyCache, cacheControl, etagFor, type CachePolicy } from "../utils/httpCache";

const router = Router();

/**
 * Two policies rather than one shortened policy, mirroring the LIST/STATUSES split already in
 * routes/stations.ts. `stale-if-error` is the important line in both: when the phone is
 * unreachable the edge keeps answering rather than failing the trip someone is mid-planning.
 */
const PLAN_CACHE: CachePolicy = {
  maxAge: envInt("PLAN_CACHE_MAXAGE", 120),
  sMaxAge: envInt("PLAN_CACHE_SMAXAGE", 600),
  swr: 3600,
  sie: 604800,
};

/** With live=1 the answer folds in charger status, which turns over every scrape cycle. */
const PLAN_CACHE_LIVE: CachePolicy = {
  maxAge: envInt("PLAN_LIVE_CACHE_MAXAGE", 30),
  sMaxAge: envInt("PLAN_LIVE_CACHE_SMAXAGE", 60),
  swr: 120,
  sie: 3600,
};

/**
 * Degraded answers (routing failed → straight-line "estimated" geometry) get a policy that is
 * deliberately short and has NO stale-if-error / stale-while-revalidate: the whole point of the
 * long policies above is to pin a *good* answer at the edge through an origin outage, and pinning
 * a guessed one for a week would do the opposite. 30 s at the edge is enough to absorb a burst
 * of identical retries while routing is down and nothing more.
 */
const PLAN_CACHE_DEGRADED: CachePolicy = { maxAge: 0, sMaxAge: 30 };

/**
 * Concurrency cap. The planner is ~50 ms of straight-line CPU on a desktop and the origin shares
 * one core with a scrape loop, so a burst is shed rather than queued: a 503 with Retry-After is a
 * better answer than every request timing out together.
 */
const MAX_INFLIGHT = envInt("PLAN_MAX_INFLIGHT", 2, { min: 1 });
let inflight = 0;

/**
 * Per-IP token bucket. This is a public, unauthenticated endpoint that costs real CPU on a phone,
 * so quantized ETags cannot be the only throttle. `req.ip` is CF-Connecting-IP behind cloudflared
 * because app.ts sets `trust proxy` to loopback — without that every visitor would share one
 * bucket. Bucket size == refill per minute, i.e. a burst of PLAN_RATE_PER_MIN then that many
 * per minute sustained; generous for a human planning trips, hostile to a scraper.
 */
// Behind carrier CGNAT one IP is many drivers, so this is deliberately generous per IP; the global
// MAX_INFLIGHT shed and Cloudflare's own rate rule protect the phone from real floods.
const RATE_PER_MIN = envInt("PLAN_RATE_PER_MIN", 60, { min: 1 });
const RATE_IDLE_EVICT_MS = 2 * 60_000;
const RATE_MAX_TRACKED_IPS = 5000;
const buckets = new Map<string, { tokens: number; at: number }>();

/** Take one token for `ip`; returns 0 when allowed, else seconds until the next token. */
function takeRateToken(ip: string, now: number): number {
  const refillPerMs = RATE_PER_MIN / 60_000;
  let b = buckets.get(ip);
  if (!b) {
    // Bounded: on overflow forget idle buckets first, then (adversarial case) the oldest.
    if (buckets.size >= RATE_MAX_TRACKED_IPS) {
      for (const [k, v] of buckets) if (now - v.at > RATE_IDLE_EVICT_MS) buckets.delete(k);
      if (buckets.size >= RATE_MAX_TRACKED_IPS) buckets.delete(buckets.keys().next().value as string);
    }
    b = { tokens: RATE_PER_MIN, at: now };
    buckets.set(ip, b);
  } else {
    b.tokens = Math.min(RATE_PER_MIN, b.tokens + Math.max(0, now - b.at) * refillPerMs);
    b.at = now;
  }
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return 0;
  }
  return Math.max(1, Math.ceil((1 - b.tokens) / refillPerMs / 1000));
}

/** When routing is unavailable we fall back to a straight line inflated by road circuity. */
const CIRCUITY = 1.3;

/**
 * Service area. The station data covers Uzbekistan; the box is drawn generously around it and its
 * neighbours (Kazakhstan's south, Kyrgyzstan, Tajikistan, Turkmenistan) so a cross-border trip is
 * still answered, while a coordinate on another continent — which can only be a typo, a swapped
 * lat/lng or a probe — is refused before it costs a routing call and a planner run.
 */
// Generous on purpose: it rejects typos and swapped coordinates, not trips. Almaty (76.9°E) and
// eastern Kyrgyzstan (78°E) are the furthest realistic road destinations from Tashkent.
const SERVICE_BBOX = { latMin: 35, latMax: 48, lngMin: 52, lngMax: 80 };

/** Bounds for the optional vehicle/search knobs. Outside these the model is meaningless. */
const KNOB_LIMITS = {
  dcKw: { min: 10, max: 1000, fallback: 90, unit: "kW (DC charging cap)" },
  consWhKm: { min: 80, max: 500, fallback: 180, unit: "Wh/km" },
  minKw: { min: 0, max: 400, fallback: 50, unit: "kW (minimum charger power)" },
  maxDetourKm: { min: 0, max: 30, fallback: 5, unit: "km" },
} as const;

const CURVE_PRESETS = ["lfp", "standard", "peaky"] as const;
const STYLES: Record<string, number> = { relaxed: 0.9, normal: 0.82, fast: 0.72 };
const TEMPS: Record<string, number> = { mild: 1.0, winter: 0.8 };

/** Plug codes as a driver reads them, for user-facing strings. Codes stay codes on the wire. */
const PLUG_LABELS: Record<(typeof ROUTABLE_PLUGS)[number], string> = {
  GBT_DC: "GB/T",
  CCS2: "CCS2",
  CCS1: "CCS1",
  NACS: "NACS",
  CHADEMO: "CHAdeMO",
};

function parseLatLng(raw: unknown): LatLng | null {
  if (typeof raw !== "string") return null;
  const [a, b] = raw.split(",");
  const lat = Number(a);
  const lng = Number(b);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function inServiceArea(p: LatLng): boolean {
  return (
    p.lat >= SERVICE_BBOX.latMin &&
    p.lat <= SERVICE_BBOX.latMax &&
    p.lng >= SERVICE_BBOX.lngMin &&
    p.lng <= SERVICE_BBOX.lngMax
  );
}

function num(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

interface ParsedQuery {
  from: LatLng;
  to: LatLng;
  rangeKm: number;
  startSoc: number;
  plug: (typeof ROUTABLE_PLUGS)[number];
  dcKw: number;
  consWhKm: number;
  curve: (typeof CURVE_PRESETS)[number];
  styleDerate: number;
  tempDerate: number;
  minKw: number;
  maxDetourKm: number;
  live: boolean;
  styleName: string;
  tempName: string;
}

type ParseError = { field: string; reason: string; message: string };

/**
 * Optional numeric knob: absent/blank → default; present but non-numeric or out of range → 400.
 * Refusing rather than clamping, because a clamped value silently plans a different car than the
 * one the client described — the client must learn its number was not accepted.
 */
function knob(q: Record<string, unknown>, field: keyof typeof KNOB_LIMITS): number | ParseError {
  const raw = q[field];
  const lim = KNOB_LIMITS[field];
  if (raw == null || raw === "") return lim.fallback;
  const n = num(raw);
  if (n === null || n < lim.min || n > lim.max) {
    return { field, reason: `invalid-${field}`, message: `${field} must be ${lim.min}-${lim.max} ${lim.unit}` };
  }
  return n;
}

function parseQuery(q: Record<string, unknown>): ParsedQuery | ParseError {
  const from = parseLatLng(q.from);
  if (!from) return { field: "from", reason: "invalid-origin", message: "from must be 'lat,lng'" };
  const to = parseLatLng(q.to);
  if (!to) return { field: "to", reason: "invalid-destination", message: "to must be 'lat,lng'" };
  const area = `lat ${SERVICE_BBOX.latMin}-${SERVICE_BBOX.latMax}, lng ${SERVICE_BBOX.lngMin}-${SERVICE_BBOX.lngMax}`;
  if (!inServiceArea(from)) {
    return { field: "from", reason: "outside-service-area", message: `from is outside the service area (${area})` };
  }
  if (!inServiceArea(to)) {
    return { field: "to", reason: "outside-service-area", message: `to is outside the service area (${area})` };
  }

  const rangeKm = num(q.range);
  if (rangeKm === null || rangeKm < 50 || rangeKm > 1200) {
    return { field: "range", reason: "invalid-range", message: "range must be 50-1200 km of real-world range at 100%" };
  }

  const socPct = num(q.soc);
  if (socPct === null || socPct <= 0 || socPct > 100) {
    return { field: "soc", reason: "invalid-soc", message: "soc must be 1-100 (percent)" };
  }

  // No default. Guessing the plug is the one error that physically strands a driver: the GB/T and
  // CCS2 networks here are nearly disjoint, so a wrong guess routes them to sockets that do not fit.
  const plugRaw = typeof q.plug === "string" ? q.plug.toUpperCase() : "";
  if (!plugRaw) {
    return { field: "plug", reason: "plug-required", message: `plug is required; one of ${ROUTABLE_PLUGS.join(", ")}` };
  }
  if (!isRoutablePlug(plugRaw)) {
    return { field: "plug", reason: "unsupported-plug", message: `plug must be one of ${ROUTABLE_PLUGS.join(", ")}` };
  }

  const dcKw = knob(q, "dcKw");
  if (typeof dcKw !== "number") return dcKw;
  const consWhKm = knob(q, "consWhKm");
  if (typeof consWhKm !== "number") return consWhKm;
  const minKw = knob(q, "minKw");
  if (typeof minKw !== "number") return minKw;
  const maxDetourKm = knob(q, "maxDetourKm");
  if (typeof maxDetourKm !== "number") return maxDetourKm;

  const curveRaw = typeof q.curve === "string" ? q.curve : "standard";
  const curve = (CURVE_PRESETS as readonly string[]).includes(curveRaw)
    ? (curveRaw as ParsedQuery["curve"])
    : "standard";

  const styleName = typeof q.style === "string" && Object.hasOwn(STYLES, q.style) ? q.style : "normal";
  const tempName = typeof q.temp === "string" && Object.hasOwn(TEMPS, q.temp) ? q.temp : "mild";

  return {
    from,
    to,
    rangeKm,
    startSoc: socPct / 100,
    plug: plugRaw,
    dcKw,
    consWhKm,
    curve,
    styleDerate: STYLES[styleName],
    tempDerate: TEMPS[tempName],
    minKw,
    maxDetourKm,
    live: q.live !== "0",
    styleName,
    tempName,
  };
}

/**
 * Cache tag. Quantized so trivially different requests share an entry — this is the cache-hit
 * strategy for a public endpoint (the per-IP bucket above is the throttle).
 *
 * `geom` is part of the tag because a routed answer and a straight-line "estimated" answer to the
 * same query are different representations: a client holding the estimated one must NOT get a
 * 304 once routing recovers, and vice versa.
 */
function planTag(p: ParsedQuery, lastMergeAt: string | null, geom: "routed" | "estimated"): string {
  const r5 = (n: number, step: number): number => Math.round(n / step) * step;
  // Underscore, not comma, between lat and lng: a comma inside an ETag is legal but hostile —
  // If-None-Match is a comma-separated list, so every naive parser in the chain (ours included,
  // until it was fixed) shreds the tag and the 304 never fires.
  return [
    "pl",
    lastMergeAt ?? "0",
    `${p.from.lat.toFixed(3)}_${p.from.lng.toFixed(3)}`,
    `${p.to.lat.toFixed(3)}_${p.to.lng.toFixed(3)}`,
    r5(p.rangeKm, 10),
    r5(p.startSoc * 100, 5),
    p.plug,
    p.dcKw,
    p.consWhKm,
    p.curve,
    p.styleName,
    p.tempName,
    p.minKw,
    p.maxDetourKm,
    p.live ? "1" : "0",
    geom,
  ].join("-");
}

/** Does the request's If-None-Match name this ETag? Same list-aware matching as applyCache. */
function ifNoneMatchHas(req: Request, etag: string): boolean {
  const header = req.headers["if-none-match"];
  if (typeof header !== "string") return false;
  const trimmed = header.trim();
  return trimmed === etag || trimmed === "*" || trimmed.split(",").some((c) => c.trim() === etag);
}

function serializePlan(plan: Plan, corridor: Corridor, geometrySource: string): Record<string, unknown> {
  return {
    id: plan.label,
    // totalMin == driveMin + chargeMin + plugMin + waitMin + terminalMin (to rounding).
    totalMin: Number(plan.totalMin.toFixed(1)),
    driveMin: Number(plan.driveMin.toFixed(1)),
    chargeMin: Number(plan.chargeMin.toFixed(1)),
    plugMin: plan.plugMin,
    waitMin: Number(plan.waitMin.toFixed(1)),
    terminalMin: plan.terminalMin,
    distanceKm: Number(corridor.totalKm.toFixed(1)),
    stops: plan.stops.length,
    arriveSocPct: Number((plan.arriveSoc * 100).toFixed(1)),
    minSocPct: Number((plan.minSoc * 100).toFixed(1)),
    chargingStops: plan.stops.map((s) => ({
      siteId: s.station.id,
      name: s.station.name,
      lat: s.station.lat,
      lng: s.station.lng,
      progressKm: Number(s.progressKm.toFixed(1)),
      lateralKm: Number(s.lateralKm.toFixed(2)),
      arriveSocPct: Number((s.arriveSoc * 100).toFixed(1)),
      departSocPct: Number((s.departSoc * 100).toFixed(1)),
      chargeMin: Number(s.chargeMin.toFixed(1)),
      gunKw: s.station.gunKw,
      // `power` means we only believe this is a DC gun because it reported >= 43 kW.
      powerConfidence: s.station.dcBasis === "power" ? "inferred" : "explicit",
      liveStatus: s.station.status,
      gatekeeper: s.isGatekeeper,
    })),
    geometry: { source: geometrySource },
  };
}

router.get("/", async (req, res, next) => {
  try {
    // ---- per-IP limiter: before anything else, so a flood costs one Map lookup per request.
    const retryInSec = takeRateToken(req.ip ?? "unknown", Date.now());
    if (retryInSec > 0) {
      res.set("Retry-After", String(retryInSec));
      res.set("Cache-Control", "no-store");
      return res.status(429).json({ message: "too many plan requests, slow down", code: "rate-limited" });
    }

    const parsed = parseQuery(req.query as Record<string, unknown>);
    if ("reason" in parsed) {
      return res.status(400).json({ message: parsed.message, field: parsed.field, reason: parsed.reason });
    }

    const lastMergeAt = getMeta("lastMergeAt");
    const policy = parsed.live ? PLAN_CACHE_LIVE : PLAN_CACHE;

    // ---- geometry ---------------------------------------------------------------------------
    // Looked up BEFORE the conditional-GET check because the ETag depends on whether we have real
    // geometry (see planTag). Cheap when cached (one indexed read); when it is not cached the
    // routing call is I/O we would have to do for a 200 anyway — and it is done OUTSIDE the
    // inflight slot, so two cold requests waiting on the provider never 503 cheap revalidations.
    const routed = await getRoute(parsed.from, parsed.to);

    {

      // ---- conditional GET ------------------------------------------------------------------
      const etagRouted = etagFor(planTag(parsed, lastMergeAt, "routed"));
      if (routed.ok) {
        if (applyCache(req, res, policy, { lastModified: lastMergeAt, tag: planTag(parsed, lastMergeAt, "routed") })) {
          return undefined;
        }
      } else {
        // Degraded. Short policy, and NO Last-Modified: an If-Modified-Since revalidation of an
        // estimated answer would otherwise 304 until the next merge even after routing recovers.
        res.set("Cache-Control", cacheControl(PLAN_CACHE_DEGRADED));
        res.set("Vary", "Accept-Encoding");
        // A client that still holds the ROUTED answer for this data version has a better answer
        // than we can compute right now (the route cache is deterministic, so it is exactly what
        // we would return once routing is back): tell it to keep it — under the normal policy,
        // because the representation it keeps is the good one, not the degraded one.
        if (ifNoneMatchHas(req, etagRouted)) {
          res.set("Cache-Control", cacheControl(policy));
          res.set("ETag", etagRouted);
          return res.status(304).end();
        }
        const etagEstimated = etagFor(planTag(parsed, lastMergeAt, "estimated"));
        res.set("ETag", etagEstimated);
        if (ifNoneMatchHas(req, etagEstimated)) return res.status(304).end();
      }
    }

    // ---- solve (the CPU-bound part) — bounded by MAX_INFLIGHT --------------------------------
    if (inflight >= MAX_INFLIGHT) {
      res.set("Retry-After", "2");
      res.set("Cache-Control", "no-store");
      return res.status(503).json({ message: "planner busy, retry shortly", reason: "busy" });
    }

    inflight++;
    try {
      // Yield once so requests that arrived meanwhile get to run their inflight check against
      // the incremented counter. Without this the planner below is a synchronous block and
      // MAX_INFLIGHT can never actually be observed as exceeded.
      await new Promise<void>((resolve) => setImmediate(resolve));

      let corridor: Corridor;
      let geometrySource: string;
      // The encoded line is returned as-is so the client can draw the route without re-routing.
      // One line per response rather than per option: every option follows the same road.
      let polyline: string | null = null;

      if (routed.ok) {
        corridor = new Corridor(decodePolyline(routed.polyline));
        geometrySource = routed.source === "cache" ? "cached" : "routed";
        polyline = routed.polyline;
      } else {
        // Synthetic geometry: a straight line inflated by typical road circuity. Distances are a
        // guess, so the response says so and the client must not present stop-level SoC as fact.
        const straight = haversineKm(parsed.from, parsed.to);
        const steps = Math.max(2, Math.ceil((straight * CIRCUITY) / 5));
        const pts = Array.from({ length: steps + 1 }, (_, i) => ({
          lat: parsed.from.lat + ((parsed.to.lat - parsed.from.lat) * i) / steps,
          lng: parsed.from.lng + ((parsed.to.lng - parsed.from.lng) * i) / steps,
        }));
        corridor = new Corridor(pts);
        geometrySource = "estimated";
      }

      // ---- candidates (memoized per plug + data version in plannerRepo) ---------------------
      const { stations, unverified } = loadCandidateStations(parsed.plug);
      const usable = parsed.live ? stations : stations.map((s) => ({ ...s, status: "unknown" as const }));

      // ---- solve ----------------------------------------------------------------------------
      const started = Date.now();
      const result: PlanResult = planRoute({
        corridor,
        stations: usable,
        rangeKm: parsed.rangeKm,
        startSoc: parsed.startSoc,
        vehicleMaxKw: parsed.dcKw,
        consKwhKm: parsed.consWhKm / 1000,
        curvePreset: parsed.curve,
        styleDerate: parsed.styleDerate,
        tempDerate: parsed.tempDerate,
        minKw: parsed.minKw,
        maxDetourKm: parsed.maxDetourKm,
      });
      const computeMs = Date.now() - started;

      const ageSec = lastMergeAt
        ? Math.max(0, Math.floor((Date.now() - Date.parse(lastMergeAt)) / 1000))
        : null;

      const body: Record<string, unknown> = {
        dataAsOf: lastMergeAt,
        dataAgeSec: ageSec,
        feasible: result.feasible,
        geometry: geometrySource,
        // On synthetic geometry the leg distances are inferred from a straight line, so the SoC
        // arithmetic built on them is not a promise. Stated explicitly rather than implied.
        geometryTrusted: geometrySource !== "estimated",
        routingError: routed.ok ? null : { reason: routed.reason, detail: routed.detail },
        distanceKm: Number(corridor.totalKm.toFixed(1)),
        // Absent on synthetic geometry: the client draws a dashed straight line itself rather
        // than being handed a fabricated road shape it cannot distinguish from a real one.
        polyline,
        vehicle: {
          rangeKm: parsed.rangeKm,
          planningRangeKm: Number(result.diagnostics.planningRangeKm.toFixed(1)),
          plug: parsed.plug,
          assumed: {
            consWhKm: parsed.consWhKm,
            packKwh: Number(((parsed.rangeKm * parsed.consWhKm) / 1000).toFixed(1)),
            dcPeakKw: parsed.dcKw,
            curve: parsed.curve,
            style: parsed.styleName,
            temp: parsed.tempName,
          },
        },
        relaxations: result.relaxations,
        diagnostics: {
          computeMs,
          candidates: {
            onCorridor: result.diagnostics.candidatesBeforeThinning,
            considered: result.diagnostics.candidatesAfterThinning,
          },
          gatekeepers: result.diagnostics.gatekeepers.length,
          unverifiedGatekeepers: result.diagnostics.unverifiedGatekeepers.length,
          paretoCapHit: result.diagnostics.paretoCapHit,
          labelsGenerated: result.diagnostics.labelsGenerated,
        },
        options: result.plans.map((p) => serializePlan(p, corridor, geometrySource)),
        // Plug-compatible sites we refuse to route through because their power is unknown.
        // Useful as map pins so the driver can see them; never presented as a planned stop.
        unverified: unverified.slice(0, 50),
        blockingGap: null as unknown,
      };

      if (!result.feasible && result.blockingGap) {
        const g = result.blockingGap;
        body.blockingGap = {
          fromKm: Number(g.fromKm.toFixed(1)),
          toKm: Number(g.toKm.toFixed(1)),
          gapKm: Number(g.gapKm.toFixed(1)),
          // A charger a few km short of the destination is not a bail-out: anyone who can reach
          // it can reach the destination. So the question is not "does the gap touch the final
          // metre" but "is there anywhere inside it worth stopping" — hence a tolerance in the
          // same order as the detour limit rather than a strict endpoint test.
          endsAtDestination: corridor.totalKm - g.toKm < 10,
          reason:
            `No ${PLUG_LABELS[parsed.plug]} charger at or above ${parsed.minKw} kW for ${g.gapKm.toFixed(0)} km ` +
            `(km ${g.fromKm.toFixed(0)}-${g.toKm.toFixed(0)}), which is further than this car can go ` +
            `on a full charge while keeping its reserve.`,
        };
        body.suggestions = [
          "Try the 'relaxed' driving style if you can hold a lower speed",
          `A car with more real-world range than ${parsed.rangeKm} km makes this trip`,
        ];
      }

      return res.json(body);
    } finally {
      inflight--;
    }
  } catch (error) {
    return next(error);
  }
});

/** Operational snapshot: is routing healthy, is the breaker open, how much budget is left. */
router.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    status: "ok",
    inflight,
    maxInflight: MAX_INFLIGHT,
    ratePerMin: RATE_PER_MIN,
    trackedIps: buckets.size,
    lastMergeAt: getMeta("lastMergeAt"),
    routing: routingHealth(),
  });
});

export default router;
