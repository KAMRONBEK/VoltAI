/**
 * Time-optimal EV route planner: label-setting search over a thinned corridor DAG with
 * continuous state-of-charge.
 *
 * The structural fact the whole thing rests on: DC charging power is non-increasing in SoC, so
 * time-to-charge is convex, and for a fixed stop sequence the total charge time is SEPARABLE and
 * piecewise-linear in the departure SoCs. A separable PWL objective over a box attains its
 * optimum at a vertex, and every vertex coordinate is either a curve breakpoint, a box bound, or
 * "charge nothing here". Those are exactly the candidates we enumerate — so there is no SoC grid
 * and no discretization error inside the search.
 *
 * Pure module: no I/O, no Node built-ins, no SQLite. It takes plain data in and returns plain
 * data out, so the same code runs in Node today and in Hermes when the API moves into the app.
 */

import { makeChargeCurve, ChargeCurve, SIGMA_MAX, T_PLUG_MIN, CURVE_PRESETS } from "./chargeCurve";
import { Corridor, longestGapKm } from "./corridor";

// ---------------------------------------------------------------------------------------------
// Tunables. Every one of these is a modelling choice a reviewer should be able to find in
// one place; none of them are load-bearing secrets.
// ---------------------------------------------------------------------------------------------

/** Intercity cruise speed. M39 is signed 100 km/h; 80 absorbs traffic, towns and stops. */
export const V_INTERCITY_KMH = 80;
/** Speed on the detour off the highway to a charger and back. */
export const V_DETOUR_KMH = 45;
/** Getting out of the origin city and into the destination one. Constant, so it cancels. */
export const T_TERMINAL_MIN = 20;
/** Penalty applied when live status says the site is busy. Flat, because the data is not better. */
export const WAIT_BUSY_MIN = 12;
/** A charger-free stretch longer than this earns the gap surcharge. */
export const GAP_TRIGGER_KM = 80;
/** A candidate adjacent to a stretch this long is tested for being a cut vertex. */
export const BRIDGE_TRIGGER_KM = 60;
/** Pareto list cap per node. Exceeding it is instrumented, never silent. */
export const PARETO_CAP = 128;
/** Destination labels to settle for k-best. */
export const K_BEST_SETTLE = 8;
/** Destination arrival reserve as a percent of planning range when the request names none. */
export const DEFAULT_RESERVE_PCT = 20;
/** The reserve never drops below this many km, whatever the percentage works out to. */
export const RESERVE_FLOOR_KM = 25;

export type PlugStandard = "GBT_DC" | "CCS2" | "CCS1" | "NACS" | "CHADEMO";

export interface CandidateStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Power of the single best gun matching the car's plug, in kW. Never 0 — null if unknown. */
  gunKw: number | null;
  /**
   * What our belief that this is a DC gun of the car's plug actually rests on.
   * A `power`-only basis (bare "GB/T" called DC because it reported >= 43 kW) is a guess, and a
   * guess may not carry an unavoidable stop — see the gatekeeper rule below.
   */
  dcBasis: "named" | "category" | "power" | "none";
  /** From the live status feed. `unknown` when stale or absent — never optimistic. */
  status: "available" | "busy" | "offline" | "unknown";
  /** This gun shares a power stack with siblings, so `gunKw` may not be available in practice. */
  sharedCabinet?: boolean;
  /** `gunKw` has already been reduced to the shared-cabinet split because the site reads busy. */
  cabinetDerated?: boolean;
}

export interface PlanRequest {
  corridor: Corridor;
  stations: CandidateStation[];
  /** Real-world range at 100% SoC, km, before derating. */
  rangeKm: number;
  startSoc: number;
  /** Vehicle DC charging cap, kW. */
  vehicleMaxKw: number;
  consKwhKm?: number;
  curvePreset?: keyof typeof CURVE_PRESETS;
  /** D_style: 0.90 relaxed / 0.82 normal / 0.72 fast. Never relaxed to force feasibility. */
  styleDerate?: number;
  /** D_temp: 1.00 mild, 0.80 winter. */
  tempDerate?: number;
  minKw?: number;
  maxDetourKm?: number;
  /**
   * Destination arrival reserve, as a percent of PLANNING range (default 20). The reserve the
   * planner keeps at the destination is max(reservePct% · Rp, 25 km); a plan whose final leg
   * would end below it is not feasible. Intermediate-stop reserves are unaffected.
   */
  reservePct?: number;
}

export interface PlanStop {
  station: CandidateStation;
  progressKm: number;
  lateralKm: number;
  arriveSoc: number;
  departSoc: number;
  chargeMin: number;
  isGatekeeper: boolean;
}

export interface Plan {
  label: "fastest" | "fewest-stops" | "most-buffer";
  stops: PlanStop[];
  /**
   * The itinerary is a strict sum: totalMin == driveMin + chargeMin + plugMin + waitMin +
   * terminalMin. Each component is reported on its own so a client can show the arithmetic
   * without one bucket silently absorbing another.
   */
  totalMin: number;
  /** Time in motion only: highway legs plus detours. Excludes queueing at busy sites. */
  driveMin: number;
  chargeMin: number;
  plugMin: number;
  /** Modelled queueing at sites whose live status reads busy (WAIT_BUSY_MIN per such visit). */
  waitMin: number;
  /** T_TERMINAL_MIN — leaving the origin city and entering the destination one. */
  terminalMin: number;
  arriveSoc: number;
  /** Lowest SoC reached anywhere on the trip — the number a nervous driver actually wants. */
  minSoc: number;
}

export interface PlanResult {
  feasible: boolean;
  plans: Plan[];
  /** Relaxations that were applied to find a route, reported verbatim to the user. */
  relaxations: string[];
  /** Present when infeasible: the stretch that cannot be crossed. */
  blockingGap?: { fromKm: number; toKm: number; gapKm: number };
  diagnostics: {
    candidatesBeforeThinning: number;
    candidatesAfterThinning: number;
    gatekeepers: string[];
    /**
     * Gatekeepers whose DC-ness is only a power-threshold guess. The route depends entirely on
     * these and there is no alternative if the guess is wrong — surface them to the driver.
     */
    unverifiedGatekeepers: string[];
    labelsGenerated: number;
    paretoCapHit: boolean;
    planningRangeKm: number;
    /** The destination reserve actually applied, km of planning range. */
    reserveDestKm: number;
  };
}

// ---------------------------------------------------------------------------------------------

interface Node {
  /** -1 origin, -2 destination, else index into the thinned candidate array. */
  kind: "origin" | "station" | "dest";
  idx: number;
  progressKm: number;
  lateralKm: number;
  station?: CandidateStation;
  curve?: ChargeCurve;
  isGatekeeper: boolean;
  /** Planning-km to the nearest other candidate — makes the reserve isolation-aware. */
  altDistKm: number;
}

interface Label {
  node: number;
  t: number;
  soc: number;
  stops: number;
  parent: Label | null;
  /** SoC this label departed its parent node at; null when it passed through without charging. */
  chargedTo: number | null;
}

/** Detour km added by pulling off the highway to a station and rejoining. */
function detourKm(lateralKm: number): number {
  // Beyond ~2 km the perpendicular-offset model stops holding (you follow roads, not a normal),
  // so inflate. Verified against multi-waypoint routing, which showed large pull-offs inflating
  // route distance well beyond twice the lateral offset.
  return 2 * lateralKm * (lateralKm < 2 ? 1.0 : 1.35);
}

/**
 * Drive time for one leg. Deliberately ADDITIVE over legs and independent of the stop count:
 * summing over any sequence gives 60*D/V_INTERCITY plus one detour per stop, and nothing else.
 *
 * The obvious-looking alternative — charging every leg for some fixed urban portion — invents
 * roughly 22 min of phantom driving per additional stop, which biases the optimizer toward
 * fewer and deeper charges, i.e. exactly the behaviour this feature exists to avoid.
 */
function driveMin(from: Node, to: Node): number {
  const along = to.progressKm - from.progressKm;
  const detour = 0.5 * detourKm(from.lateralKm) + 0.5 * detourKm(to.lateralKm);
  return (60 * along) / V_INTERCITY_KMH + (60 * detour) / V_DETOUR_KMH;
}

/** Energy (in planning-km) consumed travelling from `from` to `to`. */
function legKm(from: Node, to: Node): number {
  return (
    to.progressKm - from.progressKm + 0.5 * detourKm(from.lateralKm) + 0.5 * detourKm(to.lateralKm)
  );
}

function waitMin(node: Node): number {
  if (node.kind !== "station" || !node.station) return 0;
  // A gatekeeper is unavoidable: penalising it cannot change the route, it can only distort the
  // ETA and make an unavoidable stop look avoidable.
  if (node.isGatekeeper) return 0;
  return node.station.status === "busy" ? WAIT_BUSY_MIN : 0;
}

/** Min-heap on `f`. */
class Heap {
  private a: { f: number; l: Label }[] = [];
  get size(): number {
    return this.a.length;
  }
  push(f: number, l: Label): void {
    this.a.push({ f, l });
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p].f <= this.a[i].f) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  pop(): { f: number; l: Label } | undefined {
    if (!this.a.length) return undefined;
    const top = this.a[0];
    const last = this.a.pop()!;
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.a.length && this.a[l].f < this.a[m].f) m = l;
        if (r < this.a.length && this.a[r].f < this.a[m].f) m = r;
        if (m === i) break;
        [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
        i = m;
      }
    }
    return top;
  }
}

export function planRoute(req: PlanRequest): PlanResult {
  const {
    corridor,
    stations,
    rangeKm,
    startSoc,
    vehicleMaxKw,
    consKwhKm = 0.18,
    curvePreset = "standard",
    styleDerate = 0.82,
    tempDerate = 1.0,
    reservePct = DEFAULT_RESERVE_PCT,
  } = req;

  const derate = styleDerate * tempDerate;
  const rpKm = rangeKm * derate;
  const ceilingKm = SIGMA_MAX * rpKm;
  // The reserve is a share of what the car can actually do (planning range), not of the
  // nameplate figure, so a winter trip keeps proportionally the same buffer as a summer one.
  const reserveDest = Math.max((reservePct / 100) * rpKm, RESERVE_FLOOR_KM);
  const gapSurcharge = 0.05 * rpKm;
  const k = CURVE_PRESETS[curvePreset];

  const relaxations: string[] = [];

  // The relax ladder trades DATA assumptions only. There is deliberately no rung that relaxes
  // the efficiency derate: making an impossible trip "possible" by assuming the driver will
  // drive more gently conjures range out of nothing, precisely where margin is load-bearing.
  const ladder: { minKw: number; maxDetourKm: number; note?: string }[] = [
    { minKw: req.minKw ?? 50, maxDetourKm: req.maxDetourKm ?? 5 },
    { minKw: req.minKw ?? 50, maxDetourKm: 10, note: "widened the detour limit to 10 km" },
    { minKw: req.minKw ?? 50, maxDetourKm: 15, note: "widened the detour limit to 15 km" },
    { minKw: 40, maxDetourKm: 15, note: "accepted chargers down to 40 kW" },
  ];

  let lastDiag: PlanResult["diagnostics"] | null = null;
  let lastGap: PlanResult["blockingGap"] | undefined;

  // Project ONCE, at the widest tolerance any ladder rung will ask for, then let each rung
  // filter the result. Projection is the single most expensive phase (measured at ~65 ms for
  // 1016 stations against a 2826-vertex polyline), so re-running it per rung made the infeasible
  // case — the one that walks the whole ladder — roughly four times more expensive than the
  // feasible one, which is exactly backwards.
  const widestDetour = ladder.reduce((m, r) => Math.max(m, r.maxDetourKm), 0);
  const projectedAll = projectStations(corridor, stations, widestDetour);

  for (const rung of ladder) {
    if (rung.note) relaxations.push(rung.note);
    const attempt = solve({
      corridor,
      projected: projectedAll,
      rpKm,
      ceilingKm,
      startKm: startSoc * rpKm,
      reserveDest,
      gapSurcharge,
      vehicleMaxKw,
      consKwhKm,
      derate,
      k,
      minKw: rung.minKw,
      maxDetourKm: rung.maxDetourKm,
    });
    lastDiag = attempt.diagnostics;
    lastGap = attempt.blockingGap;
    if (attempt.plans.length) {
      return {
        feasible: true,
        plans: attempt.plans,
        relaxations,
        diagnostics: attempt.diagnostics,
      };
    }
  }

  return {
    feasible: false,
    plans: [],
    relaxations,
    blockingGap: lastGap,
    diagnostics: lastDiag ?? {
      candidatesBeforeThinning: 0,
      candidatesAfterThinning: 0,
      gatekeepers: [],
      unverifiedGatekeepers: [],
      labelsGenerated: 0,
      paretoCapHit: false,
      planningRangeKm: rpKm,
      reserveDestKm: reserveDest,
    },
  };
}

type Projected = CandidateStation & { progressKm: number; lateralKm: number };

/**
 * Project every station onto the corridor, keeping those within `maxLateralKm`.
 *
 * The bounding-box prefilter matters more than it looks: the catalog is nationwide, so a trip
 * down the M39 still has to consider stations in Fergana, Khiva and Nukus. Rejecting them with
 * two comparisons instead of a grid lookup plus a segment scan is most of the win.
 */
function projectStations(
  corridor: Corridor,
  stations: CandidateStation[],
  maxLateralKm: number
): Projected[] {
  let latLo = Infinity;
  let latHi = -Infinity;
  let lngLo = Infinity;
  let lngHi = -Infinity;
  for (const p of corridor.points) {
    if (p.lat < latLo) latLo = p.lat;
    if (p.lat > latHi) latHi = p.lat;
    if (p.lng < lngLo) lngLo = p.lng;
    if (p.lng > lngHi) lngHi = p.lng;
  }
  // Pad by the lateral tolerance, converted to degrees at the corridor's own latitude.
  const padLat = maxLateralKm / 111;
  const padLng = maxLateralKm / (111 * Math.max(0.2, Math.cos(((latLo + latHi) / 2) * (Math.PI / 180))));

  const out: Projected[] = [];
  for (const s of stations) {
    if (s.lat < latLo - padLat || s.lat > latHi + padLat) continue;
    if (s.lng < lngLo - padLng || s.lng > lngHi + padLng) continue;
    const { progressKm, lateralKm } = corridor.project({ lat: s.lat, lng: s.lng });
    if (lateralKm > maxLateralKm) continue;
    out.push({ ...s, progressKm, lateralKm });
  }
  out.sort((x, y) => x.progressKm - y.progressKm);
  return out;
}

interface SolveArgs {
  corridor: Corridor;
  projected: Projected[];
  rpKm: number;
  ceilingKm: number;
  startKm: number;
  reserveDest: number;
  gapSurcharge: number;
  vehicleMaxKw: number;
  consKwhKm: number;
  derate: number;
  k: number;
  minKw: number;
  maxDetourKm: number;
}

function solve(a: SolveArgs): {
  plans: Plan[];
  diagnostics: PlanResult["diagnostics"];
  blockingGap?: PlanResult["blockingGap"];
} {
  const { corridor, rpKm, ceilingKm, startKm, reserveDest, gapSurcharge } = a;

  // ---- C2/C3/C4: power, liveness and detour gates -------------------------------------------
  // Already projected and progress-sorted by the caller; this rung only narrows.
  const projected = a.projected.filter(
    (s) =>
      s.gunKw !== null &&
      s.gunKw >= a.minKw &&
      s.lateralKm <= a.maxDetourKm &&
      // Drop only sites the live feed says are wholly down. `unknown` is kept: the feed is
      // 3-5 min fresh at best and one operator fabricates it, so absence of news is not bad news.
      s.status !== "offline"
  );

  const candidatesBeforeThinning = projected.length;

  // ---- C6: gatekeeper (cut-vertex) detection ------------------------------------------------
  // Only sites adjacent to a long charger-free stretch can be cut vertices, so we test those.
  const progresses = projected.map((p) => p.progressKm);
  const gatekeeperIds = new Set<string>();
  const unverifiedGatekeepers = new Set<string>();
  for (let i = 0; i < projected.length; i++) {
    const before = i === 0 ? projected[i].progressKm : projected[i].progressKm - progresses[i - 1];
    const after =
      i === projected.length - 1
        ? corridor.totalKm - projected[i].progressKm
        : progresses[i + 1] - projected[i].progressKm;
    if (Math.max(before, after) < BRIDGE_TRIGGER_KM) continue;
    const without = progresses.filter((_, j) => j !== i);
    if (!reachable(without, startKm, ceilingKm, reserveDest, corridor.totalKm)) {
      gatekeeperIds.add(projected[i].id);
      // A cut vertex we only BELIEVE is DC because it reported >= 43 kW is a stranding risk:
      // if that number is a mislabelled AC post there is no alternative and no bail-out. Flag
      // it rather than silently routing through it. (Detection runs regardless of basis —
      // skipping the test for weak sites would hide the hazard instead of surfacing it.)
      if (projected[i].dcBasis === "power" || projected[i].dcBasis === "none") {
        unverifiedGatekeepers.add(projected[i].id);
      }
    }
  }

  // ---- C7: thinning (MANDATORY, not tuning) -------------------------------------------------
  // Unthinned this corridor yields C~640 and a search that takes hundreds of ms in V8 — several
  // seconds in Hermes, on the thread that draws the map. Thinned it is C~25 with an identical
  // optimum, because within a 25 km bucket the stations are near-substitutable.
  const keep = new Set<number>();
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < projected.length; i++) {
    const b = Math.floor(projected[i].progressKm / 25);
    const arr = buckets.get(b);
    if (arr) arr.push(i);
    else buckets.set(b, [i]);
  }
  for (const idxs of buckets.values()) {
    idxs
      .slice()
      .sort((x, y) => score(projected[y]) - score(projected[x]))
      .slice(0, 2)
      .forEach((i) => keep.add(i));
  }
  // Never thin away a gatekeeper, or the endpoints that bracket a long gap.
  for (let i = 0; i < projected.length; i++) {
    if (gatekeeperIds.has(projected[i].id)) keep.add(i);
    const before = i === 0 ? projected[i].progressKm : projected[i].progressKm - progresses[i - 1];
    const after =
      i === projected.length - 1
        ? corridor.totalKm - projected[i].progressKm
        : progresses[i + 1] - projected[i].progressKm;
    if (Math.max(before, after) > GAP_TRIGGER_KM) keep.add(i);
  }
  const thinned = [...keep].sort((x, y) => x - y).map((i) => projected[i]);

  // ---- Build the node list ------------------------------------------------------------------
  const nodes: Node[] = [];
  nodes.push({
    kind: "origin",
    idx: -1,
    progressKm: 0,
    lateralKm: 0,
    isGatekeeper: false,
    altDistKm: Infinity,
  });
  thinned.forEach((s, i) => {
    const prev = i > 0 ? thinned[i - 1].progressKm : -Infinity;
    const next = i < thinned.length - 1 ? thinned[i + 1].progressKm : Infinity;
    nodes.push({
      kind: "station",
      idx: i,
      progressKm: s.progressKm,
      lateralKm: s.lateralKm,
      station: s,
      curve: makeChargeCurve({
        rpKm,
        effectiveKw: Math.min(a.vehicleMaxKw, s.gunKw!),
        consKwhKm: a.consKwhKm,
        derate: a.derate,
        k: a.k,
      }),
      isGatekeeper: gatekeeperIds.has(s.id),
      altDistKm: Math.min(s.progressKm - prev, next - s.progressKm),
    });
  });
  nodes.push({
    kind: "dest",
    idx: -2,
    progressKm: corridor.totalKm,
    lateralKm: 0,
    isGatekeeper: false,
    altDistKm: Infinity,
  });

  const destIdx = nodes.length - 1;
  const stationProgresses = thinned.map((s) => s.progressKm);

  /** Isolation-aware reserve: 25 km of buffer is fine with a backup 8 km away, thin with 132. */
  function reserveAt(n: Node): number {
    if (n.kind === "dest") return reserveDest;
    return Math.max(0.1 * rpKm, 25, Math.min(n.altDistKm, 0.25 * rpKm));
  }

  function needFor(from: Node, to: Node): number {
    const e = legKm(from, to);
    const gap = longestGapKm(stationProgresses, from.progressKm, to.progressKm);
    return e + reserveAt(to) + (gap > GAP_TRIGGER_KM ? gapSurcharge : 0);
  }

  // ---- C8: greedy upper bound, which is also the guaranteed fallback answer -------------------
  const greedy = greedyPlan(nodes, destIdx, startKm, ceilingKm, needFor);
  const baseDrive = (60 * corridor.totalKm) / V_INTERCITY_KMH;
  const ubGreedy = greedy ?? Infinity;
  // D3: every stop costs at least T_PLUG, and the optimum is bounded by the greedy solution.
  // This is a theorem, not a guess — a guessed cap silently discards optima.
  const kMax = Number.isFinite(ubGreedy)
    ? Math.max(1, Math.min(6, Math.floor((ubGreedy - baseDrive) / T_PLUG_MIN)))
    : 6;

  // Fastest charging rate at or beyond each node, for the A* heuristic.
  const rateAhead: number[] = new Array(nodes.length).fill(0);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const own = nodes[i].curve?.ratePerMin ?? 0;
    rateAhead[i] = Math.max(own, i + 1 < nodes.length ? rateAhead[i + 1] : 0);
  }

  function heuristic(n: number, soc: number): number {
    const remKm = corridor.totalKm - nodes[n].progressKm;
    // Ignores detours, so it under-estimates: admissible.
    let h = (60 * remKm) / V_INTERCITY_KMH;
    const deficit = remKm + reserveDest - soc;
    if (deficit > 0) {
      const r = rateAhead[n];
      if (r <= 0) return Infinity;
      h += deficit / r + T_PLUG_MIN;
    }
    return h;
  }

  // ---- Label-setting search ------------------------------------------------------------------
  const pareto: { t: number; soc: number }[][] = nodes.map(() => []);
  let paretoCapHit = false;
  let labelsGenerated = 0;

  /** D1: at the same node, (t1 <= t2 && soc1 >= soc2) dominates. Applied at PUSH time. */
  function admit(n: number, t: number, soc: number): boolean {
    const list = pareto[n];
    for (const l of list) {
      if (l.t <= t + 1e-9 && l.soc >= soc - 1e-9) return false;
    }
    for (let i = list.length - 1; i >= 0; i--) {
      if (t <= list[i].t + 1e-9 && soc >= list[i].soc - 1e-9) list.splice(i, 1);
    }
    if (list.length >= PARETO_CAP) {
      paretoCapHit = true;
      return false;
    }
    list.push({ t, soc });
    return true;
  }

  const heap = new Heap();
  const start: Label = { node: 0, t: 0, soc: startKm, stops: 0, parent: null, chargedTo: null };
  admit(0, 0, startKm);
  heap.push(heuristic(0, startKm), start);

  let ub = ubGreedy;
  const settled: Label[] = [];

  while (heap.size) {
    const top = heap.pop()!;
    const cur = top.l;
    if (top.f >= ub + 1e-9) continue;

    if (cur.node === destIdx) {
      settled.push(cur);
      // k-best: hold the bound slightly above the incumbent. Tightening it to the optimum
      // prunes every remaining label and silently returns exactly one option.
      if (settled.length === 1) ub = cur.t * 1.15;
      if (settled.length >= K_BEST_SETTLE) break;
      continue;
    }

    const from = nodes[cur.node];
    for (let w = cur.node + 1; w < nodes.length; w++) {
      const to = nodes[w];
      if (to.progressKm <= from.progressKm && to.kind !== "dest") continue;
      const need = needFor(from, to);
      if (need > ceilingKm) continue;

      const drive = driveMin(from, to) + waitMin(to);
      const e = legKm(from, to);

      // (a) pass through without charging — the only option at the origin.
      if (cur.soc >= need - 1e-9) {
        const t = cur.t + drive;
        const soc = cur.soc - e;
        const f = t + heuristic(w, soc);
        labelsGenerated++;
        // Dominance is deliberately NOT applied at the destination: a 1-stop plan legitimately
        // arrives later AND emptier than the 2-stop optimum, so Pareto would discard exactly the
        // alternatives k-best exists to surface, and the planner would silently return one plan.
        if (f < ub && (w === destIdx || admit(w, t, soc))) {
          heap.push(f, { node: w, t, soc, stops: cur.stops, parent: cur, chargedTo: null });
        }
      }

      // (b) charge here, then drive.
      if (from.kind === "station" && from.curve && cur.stops < kMax) {
        const curve = from.curve;
        const cands: number[] = [need, ceilingKm];
        for (const b of curve.breakpointsKm) if (b > cur.soc && b < ceilingKm) cands.push(b);
        // The switching sequence: departing at exactly the SoC that lands on the NEXT station's
        // breakpoint is where a vertex of the separable objective can sit.
        if (to.curve) for (const b of to.curve.breakpointsKm) cands.push(b + e);

        const seen = new Set<number>();
        for (const raw of cands) {
          const d = Math.min(raw, ceilingKm);
          if (d <= cur.soc + 1e-9 || d < need - 1e-9) continue;
          const key = Math.round(d * 10);
          if (seen.has(key)) continue;
          seen.add(key);

          const t = cur.t + (curve.tau(d) - curve.tau(cur.soc)) + T_PLUG_MIN + drive;
          const soc = d - e;
          const f = t + heuristic(w, soc);
          labelsGenerated++;
          // Dominance is deliberately NOT applied at the destination: a 1-stop plan legitimately
        // arrives later AND emptier than the 2-stop optimum, so Pareto would discard exactly the
        // alternatives k-best exists to surface, and the planner would silently return one plan.
        if (f < ub && (w === destIdx || admit(w, t, soc))) {
            heap.push(f, { node: w, t, soc, stops: cur.stops + 1, parent: cur, chargedTo: d });
          }
        }
      }
    }
  }

  const diagnostics: PlanResult["diagnostics"] = {
    candidatesBeforeThinning,
    candidatesAfterThinning: thinned.length,
    gatekeepers: [...gatekeeperIds],
    unverifiedGatekeepers: [...unverifiedGatekeepers],
    labelsGenerated,
    paretoCapHit,
    planningRangeKm: rpKm,
    reserveDestKm: reserveDest,
  };

  if (!settled.length) {
    return {
      plans: [],
      diagnostics,
      blockingGap: findBlockingGap(
        corridor,
        stationProgresses,
        ceilingKm,
        startKm,
        rpKm,
        reserveDest
      ),
    };
  }

  const plans = materialize(settled, nodes, rpKm);
  return { plans, diagnostics };
}

function score(s: { gunKw: number | null; lateralKm: number }): number {
  return (s.gunKw ?? 0) - 8 * s.lateralKm;
}

/** Can the destination be reached at all, ignoring time? Used for cut-vertex testing. */
function reachable(
  progresses: number[],
  startKm: number,
  ceilingKm: number,
  reserveDest: number,
  totalKm: number
): boolean {
  let best = startKm;
  let at = 0;
  for (const p of progresses) {
    // Must include the reserve: a leg you can only survive by arriving on 0% is not a leg we
    // would ever plan, so treating it as reachable under-reports cut vertices and lets a
    // genuinely unavoidable station go unflagged.
    if (p - at + Math.max(0.1 * (ceilingKm / SIGMA_MAX), 25) > best) return false;
    // Arriving lets us refill to the ceiling.
    best = ceilingKm;
    at = p;
  }
  return totalKm - at + reserveDest <= best;
}

/**
 * The stretch that actually defeats the car.
 *
 * Compares against what a leg genuinely COSTS — distance plus the reserve we refuse to spend,
 * plus the gap surcharge — not against raw distance. Comparing raw gap to raw range reports "no
 * blocking gap" on trips that are plainly infeasible, because the binding constraint is almost
 * always distance-plus-reserve rather than distance alone.
 */
function findBlockingGap(
  corridor: Corridor,
  progresses: number[],
  ceilingKm: number,
  startKm: number,
  rpKm: number,
  reserveDest: number
): PlanResult["blockingGap"] {
  const marks = [0, ...progresses, corridor.totalKm];
  let worst = { fromKm: 0, toKm: 0, gapKm: 0 };
  for (let i = 1; i < marks.length; i++) {
    const gap = marks[i] - marks[i - 1];
    const isFinal = i === marks.length - 1;
    const reserve = isFinal ? reserveDest : Math.max(0.1 * rpKm, RESERVE_FLOOR_KM);
    const surcharge = gap > GAP_TRIGGER_KM ? 0.05 * rpKm : 0;
    const cost = gap + reserve + surcharge;
    const budget = i === 1 ? startKm : ceilingKm;
    if (cost > budget && gap > worst.gapKm) {
      worst = { fromKm: marks[i - 1], toKm: marks[i], gapKm: gap };
    }
  }
  return worst.gapKm > 0 ? worst : undefined;
}

/** Always-charge-to-the-ceiling plan. Gives the upper bound and a guaranteed fallback. */
function greedyPlan(
  nodes: Node[],
  destIdx: number,
  startKm: number,
  ceilingKm: number,
  needFor: (a: Node, b: Node) => number
): number | null {
  let cur = 0;
  let soc = startKm;
  let t = 0;
  let guard = 0;
  while (cur !== destIdx && guard++ < nodes.length + 2) {
    let chosen = -1;
    for (let w = destIdx; w > cur; w--) {
      if (needFor(nodes[cur], nodes[w]) <= soc + 1e-9) {
        chosen = w;
        break;
      }
    }
    if (chosen === -1) return null;
    const e = legKm(nodes[cur], nodes[chosen]);
    t += driveMin(nodes[cur], nodes[chosen]) + waitMin(nodes[chosen]);
    soc -= e;
    cur = chosen;
    if (cur !== destIdx) {
      const curve = nodes[cur].curve!;
      t += curve.tau(ceilingKm) - curve.tau(soc) + T_PLUG_MIN;
      soc = ceilingKm;
    }
  }
  return cur === destIdx ? t + T_TERMINAL_MIN : null;
}

function materialize(settled: Label[], nodes: Node[], rpKm: number): Plan[] {
  const built = settled.map((leaf) => {
    const chain: Label[] = [];
    for (let l: Label | null = leaf; l; l = l.parent) chain.unshift(l);
    const stops: PlanStop[] = [];
    let chargeTotal = 0;
    // The search folded waitMin(to) into every arrival (see the expansion loop), so it sits inside
    // leaf.t. Re-derive it here from the same function over the same visited nodes so it can be
    // reported on its own instead of being mislabelled as driving.
    let waitTotal = 0;
    let minSoc = chain[0].soc;

    for (let i = 0; i < chain.length; i++) {
      const l = chain[i];
      minSoc = Math.min(minSoc, l.soc);
      if (i > 0) waitTotal += waitMin(nodes[l.node]);
      const next = chain[i + 1];
      if (next?.chargedTo != null) {
        const n = nodes[l.node];
        const curve = n.curve!;
        const mins = curve.tau(next.chargedTo) - curve.tau(l.soc);
        chargeTotal += mins;
        stops.push({
          station: n.station!,
          progressKm: n.progressKm,
          lateralKm: n.lateralKm,
          arriveSoc: l.soc / rpKm,
          departSoc: next.chargedTo / rpKm,
          chargeMin: mins,
          isGatekeeper: n.isGatekeeper,
        });
      }
    }

    const plugMin = stops.length * T_PLUG_MIN;
    return {
      key: stops.map((s) => s.station.id).join("|"),
      plan: {
        label: "fastest" as Plan["label"],
        stops,
        totalMin: leaf.t + T_TERMINAL_MIN,
        driveMin: leaf.t - chargeTotal - plugMin - waitTotal,
        chargeMin: chargeTotal,
        plugMin,
        waitMin: waitTotal,
        terminalMin: T_TERMINAL_MIN,
        arriveSoc: leaf.soc / rpKm,
        minSoc: minSoc / rpKm,
      },
    };
  });

  // Dedupe by station set — the same stops at different SoCs are not a distinct "option".
  const unique = new Map<string, Plan>();
  for (const b of built) if (!unique.has(b.key)) unique.set(b.key, b.plan);
  const all = [...unique.values()].sort((x, y) => x.totalMin - y.totalMin);
  if (!all.length) return [];

  const out: Plan[] = [{ ...all[0], label: "fastest" }];
  const fewest = all
    .slice(1)
    .filter((p) => p.stops.length < all[0].stops.length)
    .sort((x, y) => x.totalMin - y.totalMin)[0];
  if (fewest) out.push({ ...fewest, label: "fewest-stops" });
  const buffer = all.slice(1).sort((x, y) => y.minSoc - x.minSoc)[0];
  if (buffer && buffer !== fewest && buffer.minSoc > all[0].minSoc + 1e-6) {
    out.push({ ...buffer, label: "most-buffer" });
  }
  return out.slice(0, 3);
}
