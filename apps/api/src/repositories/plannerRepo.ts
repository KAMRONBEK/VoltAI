/**
 * Candidate loading for the route planner.
 *
 * Lives in the repository layer on purpose: everything under `services/planner/` is pure and
 * dependency-free so it can move into the app unchanged, so all SQLite contact is confined here.
 *
 * Both `/api/plan` and `scripts/plan-check.ts` call this — if they built candidates separately the
 * regression harness would be testing a different graph than production serves.
 */

import { getDb } from "../db/sqlite";
import { normalizeConnector, normalizePowerKw, type PlugStandard } from "../services/connectorNormalizer";
import type { CandidateStation } from "../services/planner/planner";

interface StationRow {
  _id: string;
  name: string;
  lat: number;
  lng: number;
  connectors: string;
  primary_source: string;
}

/** A DC plug a car can actually be routed on. AC standards are excluded by construction. */
export type RoutablePlug = Extract<PlugStandard, "GBT_DC" | "CCS2" | "CCS1" | "NACS" | "CHADEMO">;

export const ROUTABLE_PLUGS: RoutablePlug[] = ["GBT_DC", "CCS2", "CCS1", "NACS", "CHADEMO"];

export function isRoutablePlug(value: string): value is RoutablePlug {
  return (ROUTABLE_PLUGS as string[]).includes(value);
}

export interface LoadedCandidates {
  stations: CandidateStation[];
  /** Sites that match the plug but have no usable power figure — map pins only, never routed. */
  unverified: { id: string; name: string; lat: number; lng: number; reason: string }[];
}

/**
 * Build the routable candidate set for one plug.
 *
 * Power note: `connector.power` is often a site cabinet rating replicated onto every gun, so a
 * multi-gun site can report more than one car will actually draw. That correction belongs in the
 * scraper; until it lands, charge-time estimates at those sites are optimistic and the API
 * reports `powerConfidence` so the client can say so.
 */
export function loadCandidateStations(plug: RoutablePlug): LoadedCandidates {
  const rows = getDb().all(
    "SELECT _id, name, lat, lng, connectors, primary_source FROM stations"
  ) as unknown as StationRow[];

  const stations: CandidateStation[] = [];
  const unverified: LoadedCandidates["unverified"] = [];

  for (const row of rows) {
    let connectors: unknown[];
    try {
      connectors = JSON.parse(row.connectors) as unknown[];
    } catch {
      continue;
    }
    if (!Array.isArray(connectors)) continue;

    let bestKw: number | null = null;
    let bestBasis: CandidateStation["dcBasis"] = "none";
    let bestShared = false;
    let bestSiteMaxKw: number | null = null;
    let matchingGunCount = 0;
    let matchedPlugWithoutPower = false;
    let anyAvailable = false;
    let anyBusy = false;
    let anyOffline = false;
    let sawStatus = false;

    for (const raw of connectors) {
      const c = raw as {
        type?: string;
        power?: number;
        category?: string;
        status?: string;
        siteMaxKw?: number;
        sharedCabinet?: boolean;
      };
      const norm = normalizeConnector({ type: c.type, power: c.power, category: c.category });
      if (norm.current !== "dc" || norm.standard !== plug) continue;

      const kw = normalizePowerKw(c.power);
      if (kw === null) {
        matchedPlugWithoutPower = true;
        continue;
      }
      matchingGunCount++;
      if (bestKw === null || kw > bestKw) {
        bestKw = kw;
        bestBasis = norm.basis;
        bestShared = c.sharedCabinet === true;
        bestSiteMaxKw = normalizePowerKw(c.siteMaxKw);
      }

      const status = String(c.status ?? "").toLowerCase();
      if (status) sawStatus = true;
      if (status === "available") anyAvailable = true;
      else if (status === "in_use" || status === "busy" || status === "unavailable") anyBusy = true;
      else if (status === "offline" || status === "maintenance" || status === "poweroff") anyOffline = true;
    }

    if (bestKw === null) {
      if (matchedPlugWithoutPower) {
        // Routing someone to a site whose power we do not know is worse than omitting it: it may
        // be a 7 kW AC post 100 km into open country. Surfaced as a pin, never as a stop.
        unverified.push({
          id: row._id,
          name: row.name,
          lat: row.lat,
          lng: row.lng,
          reason: "no usable power figure for this plug",
        });
      }
      continue;
    }

    // Only mark a site down when the feed actually says so for every gun. Absence of status is
    // `unknown`, never `available`: the feed is minutes old at best and one operator fabricates it.
    const status: CandidateStation["status"] = !sawStatus
      ? "unknown"
      : anyAvailable
        ? "available"
        : anyBusy
          ? "busy"
          : anyOffline
            ? "offline"
            : "unknown";

    // Shared-cabinet split. A multi-gun site with one power stack gives a lone car the full
    // rating, so `power` is not pre-divided — pre-dividing would under-promise every quiet
    // charger in the country and buy extra stops nobody needs. The split is applied only when
    // live status says something at the site is drawing, which is the best signal available:
    // Tokbor replicates status at station level, so "busy" genuinely means "this cabinet is in
    // use", even though it cannot say which gun.
    let effectiveKw = bestKw;
    let derated = false;
    if (bestShared && status === "busy" && matchingGunCount > 1) {
      const split = (bestSiteMaxKw ?? bestKw) / matchingGunCount;
      if (split > 0 && split < effectiveKw) {
        effectiveKw = split;
        derated = true;
      }
    }

    stations.push({
      id: row._id,
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      gunKw: effectiveKw,
      dcBasis: bestBasis,
      status,
      sharedCabinet: bestShared,
      cabinetDerated: derated,
    });
  }

  return { stations, unverified };
}
