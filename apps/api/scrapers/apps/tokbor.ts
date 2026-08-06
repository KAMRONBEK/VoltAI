import type { AppScraperConfig } from "./base";
import type { ChargerCategory, Connector, RawStationInput } from "../../src/types/station";
import { getTokborDetail } from "./tokborDetailCache";

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

// Tokbor's list `type` is the charger category.
const CATEGORY_MAP: Record<string, ChargerCategory> = {
  DC: "dc",
  ULTRA: "ultra",
  HYBRID: "hybrid",
  AC: "ac"
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

    const status = (typeof row.status === "string" && STATUS_MAP[row.status]) || "unknown";
    const category = CATEGORY_MAP[String(row.type).toUpperCase()] ?? "dc";

    // Enrich from the cached per-station detail (name/address/price/power/plug types) when
    // available; fall back to a synthesized name otherwise. See scrapers/http/enrich-tokbor.ts.
    const detail = getTokborDetail(row.id);
    // Port type comes from the detail's per-connector plug names (GBT / CCS / CHAdeMO / …);
    // the list only has the coarse DC/HYBRID/AC/ULTRA category.
    const plugs = detail?.plugs?.length ? detail.plugs : undefined;
    const count = plugs?.length ?? (detail?.connectorCount && detail.connectorCount > 0 ? detail.connectorCount : 1);
    const connectors: Connector[] = Array.from({ length: count }, (_unused, i) => ({
      type: plugs?.[i] ?? (typeof row.type === "string" ? row.type : "unknown"),
      power: detail?.capacity,
      status,
      category,
      pricePerKwh: detail?.electricityFee,
      parkingFee: detail?.idleFee,
      currency: detail?.electricityFee != null ? "UZS" : undefined
    }));

    stations.push({
      source: "tokbor",
      externalId: String(row.id),
      name: detail?.name?.trim() || `Tokbor #${row.id}`,
      address: detail?.address?.trim() || undefined,
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
