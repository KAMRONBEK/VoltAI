/**
 * GET /api/plan — time-optimal EV route with charging stops.
 *
 * GET rather than POST on purpose. The origin is one phone: `applyCache` only implements
 * conditional GET, Cloudflare will not cache a POST, and every retry or back-navigation would
 * otherwise land a fresh computation on that CPU. Making the response a pure function of the
 * query string is what allows the edge to absorb repeats.
 */

import { Router } from "express";
import { getMeta } from "../repositories/metaRepo";
import { isRoutablePlug, loadCandidateStations, ROUTABLE_PLUGS } from "../repositories/plannerRepo";
import { Corridor, decodePolyline, haversineKm } from "../services/planner/corridor";
import { planRoute, type Plan, type PlanResult } from "../services/planner/planner";
import { getRoute, routingHealth, type LatLng } from "../services/routing/mytaxi";
import { applyCache, envInt, type CachePolicy } from "../utils/httpCache";

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
 * Concurrency cap. The planner is ~50 ms of straight-line CPU on a desktop and the origin shares
 * one core with a scrape loop, so a burst is shed rather than queued: a 503 with Retry-After is a
 * better answer than every request timing out together.
 */
const MAX_INFLIGHT = envInt("PLAN_MAX_INFLIGHT", 2);
let inflight = 0;

/** When routing is unavailable we fall back to a straight line inflated by road circuity. */
const CIRCUITY = 1.3;

const CURVE_PRESETS = ["lfp", "standard", "peaky"] as const;
const STYLES: Record<string, number> = { relaxed: 0.9, normal: 0.82, fast: 0.72 };
const TEMPS: Record<string, number> = { mild: 1.0, winter: 0.8 };

function parseLatLng(raw: unknown): LatLng | null {
  if (typeof raw !== "string") return null;
  const [a, b] = raw.split(",");
  const lat = Number(a);
  const lng = Number(b);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
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

function parseQuery(q: Record<string, unknown>): ParsedQuery | ParseError {
  const from = parseLatLng(q.from);
  if (!from) return { field: "from", reason: "invalid-origin", message: "from must be 'lat,lng'" };
  const to = parseLatLng(q.to);
  if (!to) return { field: "to", reason: "invalid-destination", message: "to must be 'lat,lng'" };

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

  const curveRaw = typeof q.curve === "string" ? q.curve : "standard";
  const curve = (CURVE_PRESETS as readonly string[]).includes(curveRaw)
    ? (curveRaw as ParsedQuery["curve"])
    : "standard";

  const styleName = typeof q.style === "string" && STYLES[q.style] ? q.style : "normal";
  const tempName = typeof q.temp === "string" && TEMPS[q.temp] ? q.temp : "mild";

  return {
    from,
    to,
    rangeKm,
    startSoc: socPct / 100,
    plug: plugRaw,
    dcKw: num(q.dcKw) ?? 90,
    consWhKm: num(q.consWhKm) ?? 180,
    curve,
    styleDerate: STYLES[styleName],
    tempDerate: TEMPS[tempName],
    minKw: num(q.minKw) ?? 50,
    maxDetourKm: num(q.maxDetourKm) ?? 5,
    live: q.live !== "0",
    styleName,
    tempName,
  };
}

/** Cache tag. Quantized so trivially different requests share an entry — this is simultaneously
 * the cache-hit strategy and the only throttle on a public, unauthenticated endpoint. */
function planTag(p: ParsedQuery, lastMergeAt: string | null): string {
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
  ].join("-");
}

function serializePlan(plan: Plan, corridor: Corridor, geometrySource: string): Record<string, unknown> {
  return {
    id: plan.label,
    totalMin: Number(plan.totalMin.toFixed(1)),
    driveMin: Number(plan.driveMin.toFixed(1)),
    chargeMin: Number(plan.chargeMin.toFixed(1)),
    plugMin: plan.plugMin,
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
    const parsed = parseQuery(req.query as Record<string, unknown>);
    if ("reason" in parsed) {
      return res.status(400).json({ message: parsed.message, field: parsed.field, reason: parsed.reason });
    }

    const lastMergeAt = getMeta("lastMergeAt");
    const policy = parsed.live ? PLAN_CACHE_LIVE : PLAN_CACHE;
    // Before any work, mirroring /statuses: the ~repeat requests never reach the planner at all.
    if (applyCache(req, res, policy, { lastModified: lastMergeAt, tag: planTag(parsed, lastMergeAt) })) {
      return undefined;
    }

    if (inflight >= MAX_INFLIGHT) {
      res.set("Retry-After", "2");
      return res.status(503).json({ message: "planner busy, retry shortly", reason: "busy" });
    }

    inflight++;
    try {
      // ---- geometry -------------------------------------------------------------------------
      const routed = await getRoute(parsed.from, parsed.to);
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

      // ---- candidates -----------------------------------------------------------------------
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
            `No ${parsed.plug} charger at or above ${parsed.minKw} kW for ${g.gapKm.toFixed(0)} km ` +
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
    lastMergeAt: getMeta("lastMergeAt"),
    routing: routingHealth(),
  });
});

export default router;
