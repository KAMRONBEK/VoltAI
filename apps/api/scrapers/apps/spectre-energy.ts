import type { AppScraperConfig } from "./base";
import type { Connector, RawStationInput } from "../../src/types/station";

/**
 * Spectre Energy — Flutter app (uz.spectreEnergy.uz).
 *
 * Endpoint discovered from the shipped `libapp.so`: the mobile map is powered by
 * `GET /api/v2/station/statuses/`, which returns an unauthenticated array of
 * connector-level points (~675) with coordinates. `parseResponse` normalises one
 * row per connector; the merge step collapses the K1/K2 rows of the same physical
 * station by proximity + name similarity.
 */

const API_BASE = "https://api.spectre-energy.uz";

// status_id observed in the wild: 1 (most rows), 4, 8. We keep the raw id in
// rawData and expose a conservative label; unknown ids fall through to status-<id>.
const STATUS_LABELS: Record<number, string> = {
  1: "available",
  4: "maintenance",
  8: "unavailable"
};

interface SpectreStatusRow {
  id?: string;
  name?: string;
  status_id?: number;
  energy_power?: number;
  location?: { latitude?: number; longitude?: number };
}

function statusLabel(id: unknown): string | undefined {
  if (typeof id !== "number") {
    return undefined;
  }
  return STATUS_LABELS[id] ?? `status-${id}`;
}

/** Drop the trailing connector marker ("… K1"/"… К2") so K1/K2 share a station name. */
function stationName(raw: string): string {
  return raw.replace(/\s*[KК]\s*\d+\s*$/u, "").trim() || raw.trim();
}

function toRows(payload: unknown): SpectreStatusRow[] {
  if (Array.isArray(payload)) {
    return payload as SpectreStatusRow[];
  }
  if (payload && typeof payload === "object") {
    const results = (payload as Record<string, unknown>).results;
    if (Array.isArray(results)) {
      return results as SpectreStatusRow[];
    }
  }
  return [];
}

function parseSpectre(payload: unknown): RawStationInput[] {
  const rows = toRows(payload);
  const stations: RawStationInput[] = [];

  for (const row of rows) {
    const lat = Number(row.location?.latitude);
    const lng = Number(row.location?.longitude);
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !name) {
      continue;
    }

    // Spectre's connector-types catalog is entirely GB/T (China) DC plugs.
    const connectors: Connector[] = [];
    if (Number.isFinite(Number(row.energy_power))) {
      connectors.push({
        type: "GB/T",
        power: Number(row.energy_power),
        status: statusLabel(row.status_id)
      });
    }

    stations.push({
      source: "spectre-energy",
      externalId: String(row.id ?? `${name}-${lat}-${lng}`),
      name: stationName(name),
      location: { type: "Point", coordinates: [lng, lat] },
      connectors,
      rawData: row as Record<string, unknown>,
      scrapedAt: new Date()
    });
  }

  return stations;
}

const spectreEnergyConfig: AppScraperConfig = {
  sourceId: "spectre-energy",
  packageName: "uz.spectreEnergy.uz",
  launchActivity: ".MainActivity",
  selectors: {
    phoneInputSelector: "tap:540:640",
    otpInputSelector: "tap:540:760",
    sendOtpSelector: "tap:540:880",
    verifyOtpSelector: "tap:540:980",
    mapTabSelector: "tap:540:1820"
  },
  parseResponse: parseSpectre,
  http: [{ url: `${API_BASE}/api/v2/station/statuses/` }]
};

export default spectreEnergyConfig;
