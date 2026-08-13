/**
 * Connector canonicalization — turns the operators' free-text `type` strings into a
 * (standard, current) pair the route planner can filter on.
 *
 * Why this exists: bare "GB/T" is 1721 of our 2360 connector rows, and it is NOT a plug type.
 * GB/T AC is 7-pin and GB/T DC is 9-pin — physically non-interchangeable. Routing a driver to
 * the wrong one strands them. Resolving it against `category`/`power` takes the routable set
 * from 630 to ~1014 sites, because otherwise spectre-energy's 453 category-less GB/T rows and
 * k-watt's 198 "GB/T DC" rows are both discarded.
 *
 * Additive only: `type` and `power` are left untouched, so the existing wire contract (and the
 * mobile client that reads it) is unaffected. Callers opt in by reading the new keys.
 *
 * Pure module — no I/O, no Node built-ins — so it runs unchanged in Node, in Hermes, or in a
 * test harness.
 */

export type PlugStandard =
  | "GBT_DC"
  | "GBT_AC"
  | "CCS2"
  | "CCS1"
  | "NACS"
  | "CHADEMO"
  | "TYPE2"
  | "TYPE1"
  | "UNKNOWN";

export type CurrentKind = "dc" | "ac" | null;

/**
 * How much we trust the (standard, current) pair.
 * - `explicit`  the source named the plug unambiguously.
 * - `inferred`  we resolved it from category and/or power.
 * - `unknown`   irreducible; the connector must never be routed to.
 *
 * The planner treats this as load-bearing, not cosmetic: an `inferred` DC site may never be the
 * sole feasible option on a long leg, and may never be a gatekeeper before a gap.
 */
export type PlugConfidence = "explicit" | "inferred" | "unknown";

/**
 * WHAT the resolution rested on. This is a separate axis from `confidence` and it is
 * load-bearing for safety, not diagnostics.
 *
 * `power` means we decided a bare "GB/T" was DC purely because it reported >= 43 kW. If that
 * number is a mislabelled AC post, a driver sent there before a 132 km gap is stranded — so a
 * power-only inference is never allowed to be the sole option on a long leg. A `category` basis
 * is much stronger: the operator explicitly tagged the site DC, we only mapped the plug.
 */
export type PlugBasis = "named" | "category" | "power" | "none";

export interface NormalizedPlug {
  standard: PlugStandard;
  current: CurrentKind;
  confidence: PlugConfidence;
  basis: PlugBasis;
}

/** Below this, a GB/T connector is AC. Matches mappers.deriveCategory's threshold. */
const DC_POWER_THRESHOLD_KW = 43;

const EXPLICIT: Record<string, NormalizedPlug> = {
  "gb/t dc": { standard: "GBT_DC", current: "dc", confidence: "explicit", basis: "named" },
  "gb/t ac": { standard: "GBT_AC", current: "ac", confidence: "explicit", basis: "named" },
  ccs2: { standard: "CCS2", current: "dc", confidence: "explicit", basis: "named" },
  ccs1: { standard: "CCS1", current: "dc", confidence: "explicit", basis: "named" },
  nacs: { standard: "NACS", current: "dc", confidence: "explicit", basis: "named" },
  chademo: { standard: "CHADEMO", current: "dc", confidence: "explicit", basis: "named" },
  "type 2": { standard: "TYPE2", current: "ac", confidence: "explicit", basis: "named" },
  "type 1": { standard: "TYPE1", current: "ac", confidence: "explicit", basis: "named" },
};

/**
 * A reported power of 0 means "the source omitted it", not "this charger delivers no power".
 * Left as 0 it silently passes `>= 0` checks and produces divide-by-zero charge times, so it
 * is normalized to null everywhere and such connectors are excluded from routing.
 */
export function normalizePowerKw(power: unknown): number | null {
  if (typeof power !== "number" || !Number.isFinite(power) || power <= 0) return null;
  return power;
}

/**
 * Resolve one connector's plug identity.
 *
 * `category` and `power` are only consulted for the ambiguous bare-"GB/T" case and the bare
 * "DC"/"CCS" strays — every named plug wins outright, because a source that bothered to write
 * "CCS2" is more reliable than our power heuristic.
 */
export function normalizeConnector(input: {
  type?: string | null;
  power?: number | null;
  category?: string | null;
}): NormalizedPlug {
  const raw = (input.type ?? "").trim().toLowerCase();
  const kw = normalizePowerKw(input.power);
  const category = (input.category ?? "").trim().toLowerCase();

  const explicit = EXPLICIT[raw];
  if (explicit) return explicit;

  // "CCS" with no generation. Uzbekistan is a CCS2 market (CCS1 is 13 rows, all US imports),
  // so CCS2 is the right guess — but it stays `inferred`.
  if (raw === "ccs") {
    return { standard: "CCS2", current: "dc", confidence: "inferred", basis: "named" };
  }

  // Bare "DC" with no plug named: we know the current, not the socket. Unroutable.
  if (raw === "dc") {
    return { standard: "UNKNOWN", current: "dc", confidence: "unknown", basis: "none" };
  }

  if (raw === "gb/t" || raw === "gbt" || raw === "gb/t гост" || raw === "гост") {
    if (category === "dc" || category === "ultra") {
      return { standard: "GBT_DC", current: "dc", confidence: "inferred", basis: "category" };
    }
    if (category === "ac") {
      return { standard: "GBT_AC", current: "ac", confidence: "inferred", basis: "category" };
    }
    // `hybrid` means the SITE has both AC and DC; it says nothing about this gun. Fall through
    // to power, which is the only signal left. Same for a missing category.
    if (kw !== null) {
      return kw >= DC_POWER_THRESHOLD_KW
        ? { standard: "GBT_DC", current: "dc", confidence: "inferred", basis: "power" }
        : { standard: "GBT_AC", current: "ac", confidence: "inferred", basis: "power" };
    }
    return { standard: "UNKNOWN", current: null, confidence: "unknown", basis: "none" };
  }

  return { standard: "UNKNOWN", current: null, confidence: "unknown", basis: "none" };
}

/** True when this connector is a DC gun of the plug the car actually carries. */
export function isRoutableFor(plug: NormalizedPlug, carPlug: PlugStandard): boolean {
  return plug.current === "dc" && plug.standard === carPlug && plug.confidence !== "unknown";
}
