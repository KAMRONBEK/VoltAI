import type { AppScraperConfig } from "./base";
import type { Connector, RawStationInput } from "../../src/types/station";

/**
 * Tokbor (uz.tokbor.tokbor) — Flutter app, base api.newtokbor.uz.
 *
 * Auth-gated (bearer via OTP login-replay, see scrapers/auth/tokbor.ts — the
 * token is valid ~365 days). The API also requires an `app-version` header or it
 * returns 400 "Ilova versiyasi talab qilinadi".
 *
 * GET /charging-station returns ~1128 lightweight map pins:
 *   { id, lat, lng, status, type, discounted, hasTaxiDiscount, icon }
 * There is no name in the list — names/addresses/capacity live at
 * GET /charging-station/{id} (per-station, so not fetched on every cron). We
 * therefore synthesize a stable name from the id; enrichment can backfill later.
 */

const API_BASE = process.env.TOKBOR_API_BASE ?? "https://api.newtokbor.uz";
// The app-version the API will accept. Bump if Tokbor starts 426-ing this value.
const APP_VERSION = process.env.TOKBOR_APP_VERSION ?? "3.1.1";

const STATUS_MAP: Record<string, string> = {
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
  MAINTENANCE: "maintenance",
  POWEROFF: "offline",
  EMERGENCY_STOP: "offline"
};

interface TokborPin {
  id?: number | string;
  lat?: number;
  lng?: number;
  status?: string;
  type?: string;
}

function toRows(payload: unknown): TokborPin[] {
  if (Array.isArray(payload)) return payload as TokborPin[];
  if (payload && typeof payload === "object") {
    const data = (payload as Record<string, unknown>).data;
    if (Array.isArray(data)) return data as TokborPin[];
  }
  return [];
}

function parseTokbor(payload: unknown): RawStationInput[] {
  const rows = toRows(payload);
  const stations: RawStationInput[] = [];

  for (const row of rows) {
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || row.id == null) {
      continue;
    }

    const connectorType = typeof row.type === "string" && row.type.trim() ? row.type.trim() : "unknown";
    const status = (typeof row.status === "string" && STATUS_MAP[row.status]) || "unknown";
    const connectors: Connector[] = [{ type: connectorType, status }];

    stations.push({
      source: "tokbor",
      externalId: String(row.id),
      // List has no name; real name is at /charging-station/{id}. Synthesized name
      // is unique per station so the merge never collapses distinct Tokbor pins.
      name: `Tokbor #${row.id}`,
      location: { type: "Point", coordinates: [lng, lat] },
      connectors,
      rawData: row as Record<string, unknown>,
      scrapedAt: new Date()
    });
  }

  return stations;
}

const tokborConfig: AppScraperConfig = {
  sourceId: "tokbor",
  packageName: "uz.tokbor.tokbor",
  launchActivity: ".MainActivity",
  selectors: {
    phoneInputSelector: "tap:540:640",
    otpInputSelector: "tap:540:760",
    sendOtpSelector: "tap:540:880",
    verifyOtpSelector: "tap:540:980",
    mapTabSelector: "tap:540:1820"
  },
  parseResponse: parseTokbor,
  http: [{ url: `${API_BASE}/charging-station`, auth: true, headers: { "app-version": APP_VERSION } }]
};

export default tokborConfig;
