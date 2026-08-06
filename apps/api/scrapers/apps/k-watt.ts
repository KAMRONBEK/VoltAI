import type { AppScraperConfig } from "./base";
import type { Connector, RawStationInput } from "../../src/types/station";

/**
 * K-Watt (org.uicgroup.kwattapp, UIC Group) — Flutter app.
 *
 * Endpoint discovered from the shipped `libapp.so`: baseUrl `app.k-watt.uz/api/v1/`
 * + `core/charge-point-list/`. Returns a DRF-paginated list (~88 stations) with
 * nested charge_points -> connectors, unauthenticated. Rich payload: per-connector
 * plug type (`type_connection_name`), power (`power_name`), price, and live status.
 */

const API_BASE = "https://app.k-watt.uz/api/v1";

interface KwattConnector {
  power_name?: string;
  type_connection_name?: string;
  status?: unknown;
  price?: {
    price_connector?: string;
    price_parking?: string;
  };
}

/** "2 350" / "2,350" -> 2350 */
function parseMoney(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number(value.replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

interface KwattChargePoint {
  type?: string;
  connected?: boolean;
  status?: boolean;
  connectors?: KwattConnector[];
}

interface KwattStation {
  id?: number | string;
  name?: string;
  address?: string;
  landmark?: string;
  longitude?: string | number;
  latitude?: string | number;
  charge_points?: KwattChargePoint[];
}

/** "160.0  kW" / "160 kW" -> 160 */
function parsePower(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = value.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : undefined;
}

function toRows(payload: unknown): KwattStation[] {
  if (Array.isArray(payload)) {
    return payload as KwattStation[];
  }
  if (payload && typeof payload === "object") {
    const results = (payload as Record<string, unknown>).results;
    if (Array.isArray(results)) {
      return results as KwattStation[];
    }
  }
  return [];
}

function parseKwatt(payload: unknown): RawStationInput[] {
  const rows = toRows(payload);
  const stations: RawStationInput[] = [];

  for (const row of rows) {
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !name) {
      continue;
    }

    const connectors: Connector[] = [];
    for (const point of row.charge_points ?? []) {
      const online = point.connected !== false && point.status !== false;
      for (const connector of point.connectors ?? []) {
        connectors.push({
          type: connector.type_connection_name?.trim() || "unknown",
          power: parsePower(connector.power_name) ?? parsePower(point.type),
          status: online ? "available" : "offline",
          pricePerKwh: parseMoney(connector.price?.price_connector),
          parkingFee: parseMoney(connector.price?.price_parking),
          currency: "UZS"
        });
      }
    }

    const address = [row.address, row.landmark]
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean)
      .join(", ");

    stations.push({
      source: "k-watt",
      externalId: String(row.id ?? `${name}-${lat}-${lng}`),
      name,
      address: address || undefined,
      location: { type: "Point", coordinates: [lng, lat] },
      connectors,
      rawData: row as Record<string, unknown>,
      scrapedAt: new Date()
    });
  }

  return stations;
}

const kWattConfig: AppScraperConfig = {
  sourceId: "k-watt",
  packageName: "org.uicgroup.kwattapp",
  launchActivity: ".MainActivity",
  selectors: {
    phoneInputSelector: "tap:540:640",
    otpInputSelector: "tap:540:760",
    sendOtpSelector: "tap:540:880",
    verifyOtpSelector: "tap:540:980",
    mapTabSelector: "tap:540:1820"
  },
  parseResponse: parseKwatt,
  http: [{ url: `${API_BASE}/core/charge-point-list/` }]
};

export default kWattConfig;
