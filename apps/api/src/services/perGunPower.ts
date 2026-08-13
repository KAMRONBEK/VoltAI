/**
 * Per-gun power derivation.
 *
 * Several operator APIs expose only a single site figure — Tokbor's `capacity`, Beon's
 * `maxCapacity` — which the scrapers then copied onto every connector. That is wrong in the way
 * that matters most: a site named "Andalus 60+100kW" has a 60 kW gun and a 100 kW gun, but both
 * were reported as the site's 160 kW. A charge-time model reading 160 off the 60 kW gun
 * overestimates by 2.7x, and charge time is precisely the quantity the route planner minimizes.
 *
 * The operator's own name is the most reliable per-gun signal available: when a name lists as
 * many powers as the site has guns, those are the guns. `capacity` is an advertised headline
 * figure and is NOT a dependable sum — measured across the Tokbor detail cache, only 8 of 12
 * "A+B" names sum to it, and one site advertises less than its own name lists.
 *
 * Pure module — no I/O, no Node built-ins.
 */

/** What a gun's power figure actually rests on. Surfaced so consumers can caveat honestly. */
export type PowerBasis =
  /** The site name listed one power per gun. Strongest signal we have. */
  | "name"
  /** Single-gun site: the site rating is the gun rating, unambiguously. */
  | "site-single"
  /** Multi-gun with differing plug types — typically alternatives on one outlet, so each can
   *  draw the whole cabinet. */
  | "site-alternative"
  /** Multi-gun, same plug: one cabinet feeding several guns. Full power alone, split when busy. */
  | "site-shared"
  /** No usable figure anywhere. Must not be routed to. */
  | "unknown";

export interface GunPower {
  /** What this gun can deliver with the cabinet otherwise idle. null when unknown. */
  kw: number | null;
  basis: PowerBasis;
  /** True when this gun shares a power stack with siblings and may be throttled if they are busy. */
  sharedCabinet: boolean;
  /** The whole site's rating, retained so consumers can compute the shared-case split. */
  siteMaxKw: number | null;
  /** Set when the name and the site figure disagree in a way we could not reconcile. */
  conflict?: string;
}

/**
 * Pull power figures out of an operator's station name.
 *
 * Matches "120kW", "60+100 kW", "30 + 60 кВт". The kW suffix is required, so a street number or
 * a mall's name can never be mistaken for a power rating.
 */
export function parseNamePowers(name: string | undefined | null): number[] {
  if (!name) return [];
  const match = name.match(/(\d+(?:\s*\+\s*\d+)*)\s*(?:kw|kвт|кВт|квт)/i);
  if (!match) return [];
  return match[1]
    .split("+")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function normalizeSiteKw(value: unknown): number | null {
  // A reported 0 means "the source omitted it", not "delivers no power".
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Derive one power figure per gun.
 *
 * @param name    the operator's station name, which frequently encodes per-gun powers
 * @param siteKw  the site/cabinet rating the API reports
 * @param plugs   per-gun plug labels; length defines the gun count
 */
export function derivePerGunPower(params: {
  name?: string | null;
  siteKw?: number | null;
  plugs: (string | undefined)[];
}): GunPower[] {
  const gunCount = Math.max(1, params.plugs.length);
  const siteMaxKw = normalizeSiteKw(params.siteKw);
  const named = parseNamePowers(params.name);

  // 1. The name lists exactly one power per gun — believe it. This is the case the old code got
  //    badly wrong, replacing e.g. [60, 100] with [160, 160].
  if (named.length > 1 && named.length === gunCount) {
    const sum = named.reduce((a, b) => a + b, 0);
    // Only a diagnostic: the site figure is an advertised headline, so a mismatch does not
    // discredit the per-gun breakdown the operator wrote in their own name.
    const conflict =
      siteMaxKw != null && Math.abs(sum - siteMaxKw) > 1
        ? `name lists ${named.join("+")}=${sum} kW but site advertises ${siteMaxKw} kW`
        : undefined;
    return named.map((kw) => ({
      kw,
      basis: "name" as const,
      sharedCabinet: false,
      siteMaxKw: siteMaxKw ?? sum,
      conflict,
    }));
  }

  // A name listing powers that does NOT match the gun count tells us nothing per-gun, but it is
  // worth carrying as a diagnostic — and worth capping by, since a gun cannot exceed its cabinet.
  const nameMismatch =
    named.length > 1 && named.length !== gunCount
      ? `name lists ${named.length} powers (${named.join("+")}) but site reports ${gunCount} guns`
      : undefined;

  if (siteMaxKw == null) {
    // A single-figure name is still better than nothing when the API omitted capacity entirely.
    const fromName = named.length === 1 ? named[0] : null;
    return Array.from({ length: gunCount }, () => ({
      kw: fromName,
      basis: fromName == null ? ("unknown" as const) : ("site-shared" as const),
      sharedCabinet: fromName != null && gunCount > 1,
      siteMaxKw: fromName,
      conflict: nameMismatch,
    }));
  }

  if (gunCount === 1) {
    return [
      { kw: siteMaxKw, basis: "site-single", sharedCabinet: false, siteMaxKw, conflict: nameMismatch },
    ];
  }

  // 2. Mixed plug standards on one site almost always means one outlet with alternative
  //    connectors — you use one or the other, so each can draw the whole cabinet.
  const distinctPlugs = new Set(params.plugs.filter(Boolean).map((p) => String(p).toUpperCase()));
  if (distinctPlugs.size > 1) {
    return Array.from({ length: gunCount }, () => ({
      kw: siteMaxKw,
      basis: "site-alternative" as const,
      sharedCabinet: false,
      siteMaxKw,
      conflict: nameMismatch,
    }));
  }

  // 3. Same plug, several guns: one power stack shared between them. A lone car gets the full
  //    rating, which is why `kw` stays at the site figure rather than being pre-divided —
  //    pre-dividing would under-promise every quiet charger in the country. The split is applied
  //    downstream, only when live status suggests a sibling is actually drawing.
  return Array.from({ length: gunCount }, () => ({
    kw: siteMaxKw,
    basis: "site-shared" as const,
    sharedCabinet: true,
    siteMaxKw,
    conflict: nameMismatch,
  }));
}
