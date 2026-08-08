import type { AppScraperConfig } from "./base";
import type { Connector, RawStationInput } from "../../src/types/station";

/**
 * Pro-Tok (com.fintech_projects.fintech_project1) — Flutter, base crm.protok.uz/api.
 *
 * Auth-gated (bearer via OTP login-replay, see scrapers/auth/pro-tok.ts — auth request shape is
 * UNCONFIRMED). Station data:
 *   GET /Connector/List   -> flat connector list (unauth returns 401).
 *
 * ⚠️ The connector shape is confirmed on the first authenticated fetch. `parseProTok` is
 * defensive: it reads a flat connector list and groups connectors into stations by shared
 * station id (falling back to shared coordinates). Tighten the field names — plug type, power,
 * status, price — once a real /Connector/List response is in hand.
 */

const API_BASE = process.env.PROTOK_API_BASE ?? "https://crm.protok.uz/api";

type Rec = Record<string, unknown>;

function num(rec: Rec, keys: string[]): number {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return Number.NaN;
}

function str(rec: Rec, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

function toRecords(payload: unknown): Rec[] {
  if (Array.isArray(payload)) return payload as Rec[];
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Rec;
  for (const key of ["data", "items", "connectors", "list", "results"]) {
    const v = obj[key];
    if (Array.isArray(v)) return v as Rec[];
  }
  return [];
}

function parseProTok(payload: unknown): RawStationInput[] {
  const byStation = new Map<string, { name: string; address?: string; lat: number; lng: number; connectors: Connector[]; raw: Rec[] }>();

  for (const rec of toRecords(payload)) {
    const lat = num(rec, ["lat", "latitude", "y"]);
    const lng = num(rec, ["lng", "lon", "long", "longitude", "x"]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const stationId =
      str(rec, ["stationId", "chargePointId", "pointId", "station_id"]) ?? `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const name = str(rec, ["stationName", "name", "title", "address"]) ?? `Pro-Tok ${stationId}`;

    const connector: Connector = {
      type: str(rec, ["connectorType", "type", "plugType", "standard"]) ?? "unknown",
      power: num(rec, ["power", "maxPower", "powerKw", "kw"]) || undefined,
      status: str(rec, ["status", "state", "connectorStatus"]),
      pricePerKwh: num(rec, ["price", "pricePerKwh", "tariff"]) || undefined,
      currency: "UZS"
    };

    const existing = byStation.get(stationId);
    if (existing) {
      existing.connectors.push(connector);
      existing.raw.push(rec);
    } else {
      byStation.set(stationId, {
        name,
        address: str(rec, ["address", "location", "description"]),
        lat,
        lng,
        connectors: [connector],
        raw: [rec]
      });
    }
  }

  const out: RawStationInput[] = [];
  for (const [stationId, s] of byStation) {
    out.push({
      source: "pro-tok",
      externalId: stationId,
      name: s.name,
      address: s.address,
      location: { type: "Point", coordinates: [s.lng, s.lat] },
      connectors: s.connectors,
      rawData: { connectors: s.raw },
      scrapedAt: new Date()
    });
  }
  return out;
}

const proTokConfig: AppScraperConfig = {
  sourceId: "pro-tok",
  packageName: "com.fintech_projects.fintech_project1",
  launchActivity: ".MainActivity",
  selectors: {
    phoneInputSelector: "tap:540:640",
    otpInputSelector: "tap:540:760",
    sendOtpSelector: "tap:540:880",
    verifyOtpSelector: "tap:540:980",
    mapTabSelector: "tap:540:1820"
  },
  parseResponse: parseProTok,
  http: [{ url: `${API_BASE}/Connector/List`, auth: true }]
};

export default proTokConfig;
