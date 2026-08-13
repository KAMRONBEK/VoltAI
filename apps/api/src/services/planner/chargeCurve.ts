/**
 * DC charging model: time-to-charge as a piecewise-linear function of state-of-charge.
 *
 * Ground truth is the CC-CV taper, which measured curves (Fastned / EV-Database / P3) fit as
 * LINEAR in (1 - sigma), not parabolic:
 *
 *     P(sigma) = P_eff * min(1, k * (1 - sigma))        knee at sigma_k = 1 - 1/k
 *
 * A literal downward parabola is disqualified because it reaches zero power at its vertex,
 * which makes high SoC unreachable in finite time. Integrating the linear taper instead gives
 * sigma(t) = 1 - (1 - sigma_0) * e^(-lambda*t) — the flattening curve drivers actually see, and
 * the one to plot in the UI. Never plot power-vs-SoC; it looks like a cliff and reads as a bug.
 *
 * The search needs time-to-charge piecewise-LINEAR, so power is discretized into a staircase.
 * Using the LOG-MEAN band multiplier makes staircase time equal the exact CC-CV integral at
 * every band edge, rather than merely near it:
 *
 *     m_b = k * (sb - sa) / ln((1 - sa) / (1 - sb))
 *
 * Pure module — no I/O, no Node built-ins.
 */

/**
 * Taper aggressiveness. Higher k = the taper starts later and bites harder.
 * `lfp` holds power longest (LFP packs), `peaky` is an early-tapering NMC.
 */
export const CURVE_PRESETS = { lfp: 2.0, standard: 1.8, peaky: 1.3 } as const;
export type CurvePreset = keyof typeof CURVE_PRESETS;

/**
 * Hard ceiling on planned SoC. Above this the model is least trustworthy (time diverges as
 * sigma -> 1), and no driver actually executes a plan that tells them to sit at 98%.
 */
export const SIGMA_MAX = 0.9;

/** Minutes of park + plug + authorise + unplug, charged once per stop. */
export const T_PLUG_MIN = 5;

export interface ChargeCurve {
  /** Cumulative minutes to charge from empty to `s` planning-km. Monotone non-decreasing. */
  tau(s: number): number;
  /** Departure-SoC candidates: the band edges, in planning-km. */
  breakpointsKm: number[];
  /** SIGMA_MAX expressed in planning-km — the usable top of the pack. */
  ceilingKm: number;
  /** Planning-km added per minute at full (pre-taper) power. */
  ratePerMin: number;
}

/**
 * Band edges in sigma: everything below the knee runs at full power, then uniform 0.05 steps
 * to SIGMA_MAX. Fine enough that the worst per-session error against the exact integral is
 * ~0.43 min; coarse enough that tau() stays O(11).
 */
function bandEdges(k: number): number[] {
  const knee = 1 - 1 / k;
  const edges = [0, knee];
  // Skip a step that lands within 0.01 sigma of the knee: it would create a degenerate sliver
  // band (k=1.8 puts the knee at 0.4444, so the 0.45 step is 0.0056 wide) whose only effect is
  // an extra useless departure-SoC candidate on every arc.
  for (let s = Math.ceil(knee / 0.05) * 0.05; s < SIGMA_MAX - 1e-9; s += 0.05) {
    if (s > knee + 0.01) edges.push(Number(s.toFixed(4)));
  }
  edges.push(SIGMA_MAX);
  return edges;
}

/**
 * Log-mean power multiplier for the band [sa, sb]. Equals the exact CC-CV integral at both
 * edges. Below the knee power is flat, so the multiplier is exactly 1.
 */
function bandMultiplier(sa: number, sb: number, k: number): number {
  const knee = 1 - 1 / k;
  if (sb <= knee + 1e-9) return 1;
  const lo = Math.max(sa, knee);
  const denom = Math.log((1 - lo) / (1 - sb));
  if (denom <= 0) return 1;
  return (k * (sb - lo)) / denom;
}

/**
 * Chord slopes of a convex increasing tau are non-decreasing, so the multipliers this grid
 * produces are non-increasing BY CONSTRUCTION — the grid cannot break it. The assert exists to
 * catch a future edit to P(sigma) itself.
 *
 * Note precisely which proof this guards: candidate COMPLETENESS (the claim that the optimal
 * departure SoC always lands on an enumerated breakpoint) is what needs non-increasing power.
 * Pareto dominance only needs tau non-decreasing. So if someone later models the real cold-pack
 * ramp-up at 0-10% SoC, dominance stays sound and the planner silently returns sub-optimal
 * routes with no error — which is why this must throw loudly rather than warn.
 */
function assertNonIncreasing(multipliers: number[]): void {
  for (let i = 1; i < multipliers.length; i++) {
    if (multipliers[i] > multipliers[i - 1] + 1e-9) {
      throw new Error(
        `chargeCurve: power multiplier increased across band ${i} ` +
          `(${multipliers[i - 1]} -> ${multipliers[i]}). Candidate completeness (planner section 2.6) ` +
          `assumes power is non-increasing in SoC; with a rising segment the enumerated departure ` +
          `SoCs no longer contain the optimum and the planner degrades silently. Fix P(sigma), ` +
          `do not relax this assert.`
      );
    }
  }
}

/**
 * Build the charge curve for one (vehicle, gun) pairing.
 *
 * @param rpKm      planning range at 100% SoC (already derated) — the unit of all SoC state
 * @param effectiveKw min(vehicle DC cap, this gun's kW)
 * @param consKwhKm consumption used to derive pack size from range
 * @param derate    D_style * D_temp, so charged energy lands in the same planning-km units
 * @param k         taper aggressiveness
 * @param etaDc     DC efficiency, applied to power only — never re-applied above 80%, because
 *                  the taper already encodes that loss
 */
export function makeChargeCurve(params: {
  rpKm: number;
  effectiveKw: number;
  consKwhKm: number;
  derate: number;
  k: number;
  etaDc?: number;
}): ChargeCurve {
  const { rpKm, effectiveKw, consKwhKm, derate, k, etaDc = 0.9 } = params;

  // Fail loudly on nonsense inputs. NaN in particular propagates silently all the way to a
  // finished-looking itinerary with NaN charge times, because every NaN comparison is false —
  // including the non-increasing assert below, which would wave it straight through.
  const finite = (n: number): boolean => typeof n === "number" && Number.isFinite(n) && n > 0;
  if (!finite(rpKm) || !finite(effectiveKw) || !finite(consKwhKm) || !finite(derate) || !finite(etaDc)) {
    throw new Error(
      `chargeCurve: non-finite or non-positive parameter ` +
        `(rpKm=${rpKm}, effectiveKw=${effectiveKw}, consKwhKm=${consKwhKm}, derate=${derate}, etaDc=${etaDc})`
    );
  }
  if (!finite(k) || k <= 1) {
    throw new Error(`chargeCurve: taper k must be > 1 (got ${k}); k <= 1 puts the knee at or below 0 SoC`);
  }

  // Planning-km added per minute at full power. Derived from pack size B = R * cons, but R
  // cancels: (P*eta/60/cons) real-km per min, times Rp/R = derate, gives planning-km per min.
  const ratePerMin = (effectiveKw * etaDc * derate) / (60 * consKwhKm);

  const edges = bandEdges(k);
  const multipliers: number[] = [];
  for (let i = 1; i < edges.length; i++) {
    multipliers.push(bandMultiplier(edges[i - 1], edges[i], k));
  }
  assertNonIncreasing(multipliers);

  // Cumulative minutes at each band edge, so tau() is a lookup plus one linear interpolation.
  const edgeKm = edges.map((s) => s * rpKm);
  const cumMin: number[] = [0];
  for (let i = 1; i < edges.length; i++) {
    const width = edgeKm[i] - edgeKm[i - 1];
    cumMin.push(cumMin[i - 1] + width / (ratePerMin * multipliers[i - 1]));
  }

  const ceilingKm = SIGMA_MAX * rpKm;

  function tau(s: number): number {
    const clamped = Math.max(0, Math.min(s, ceilingKm));
    let b = 1;
    while (b < edgeKm.length - 1 && clamped > edgeKm[b]) b++;
    const within = clamped - edgeKm[b - 1];
    return cumMin[b - 1] + within / (ratePerMin * multipliers[b - 1]);
  }

  return {
    tau,
    // Interior edges only: 0 is never a useful departure target, and the ceiling is added
    // explicitly by the planner's candidate set.
    breakpointsKm: edgeKm.slice(1, -1),
    ceilingKm,
    ratePerMin,
  };
}
