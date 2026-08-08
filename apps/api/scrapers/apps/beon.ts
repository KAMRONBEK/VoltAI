import type { AppScraperConfig } from "./base";
import type { ChargerCategory, Connector, RawStationInput } from "../../src/types/station";

/**
 * Beon (uz.beonapp.uz) — Flutter, base api.v2.beon-app.com.
 *
 * Auth-gated (bearer via OTP login-replay, see scrapers/auth/beon.ts). Station data:
 *   GET /map (bearer) -> { count, list: [...] }  (~89 sites; unauth = 403 AUTHORIZATION_MISSING).
 *
 * Each `list` item is a site:
 *   { id, geoLocation:{lat,lng}, cpo:{ name, tradeMark, ... }, maxCapacity (kW),
 *     freeConnectorsCount, maxConnectorsCount, stations }
 * There's no plug type or per-connector detail in the list — the map shows category (from
 * maxCapacity) + a status dot per connector (free → available, else unavailable).
 */

const API_BASE = process.env.BEON_API_BASE ?? "https://api.v2.beon-app.com";

interface BeonSite {
  id?: string | number;
  geoLocation?: { lat?: number; lng?: number };
  cpo?: { name?: string; tradeMark?: string };
  maxCapacity?: number;
  freeConnectorsCount?: number;
  maxConnectorsCount?: number;
}

function categoryFor(powerKw?: number): ChargerCategory | undefined {
  if (!powerKw || !Number.isFinite(powerKw)) return undefined;
  if (powerKw >= 150) return "ultra";
  if (powerKw >= 43) return "dc";
  return "ac";
}

function parseBeon(payload: unknown): RawStationInput[] {
  const list = (payload as { list?: unknown })?.list;
  if (!Array.isArray(list)) return [];

  const stations: RawStationInput[] = [];
  for (const site of list as BeonSite[]) {
    const lat = Number(site.geoLocation?.lat);
    const lng = Number(site.geoLocation?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || site.id == null) continue;

    const brand = (site.cpo?.tradeMark || site.cpo?.name || "").trim();
    const name = brand || `Beon ${site.id}`;
    const power = Number(site.maxCapacity) || undefined;
    const category = categoryFor(power);

    const total = Math.max(1, Number(site.maxConnectorsCount) || 1);
    const free = Math.max(0, Math.min(total, Number(site.freeConnectorsCount) || 0));
    const connectors: Connector[] = Array.from({ length: total }, (_unused, i) => ({
      type: "unknown",
      power,
      status: i < free ? "available" : "unavailable",
      category
    }));

    stations.push({
      source: "beon",
      externalId: String(site.id),
      name,
      location: { type: "Point", coordinates: [lng, lat] },
      connectors,
      rawData: site as Record<string, unknown>,
      scrapedAt: new Date()
    });
  }
  return stations;
}

const beonConfig: AppScraperConfig = {
  sourceId: "beon",
  packageName: "uz.beonapp.uz",
  launchActivity: ".MainActivity",
  selectors: {
    phoneInputSelector: "tap:540:640",
    otpInputSelector: "tap:540:760",
    sendOtpSelector: "tap:540:880",
    verifyOtpSelector: "tap:540:980",
    mapTabSelector: "tap:540:1820"
  },
  parseResponse: parseBeon,
  http: [{ url: `${API_BASE}/map`, auth: true }]
};

export default beonConfig;
