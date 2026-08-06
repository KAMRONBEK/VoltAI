/**
 * Row <-> wire-format translation. This is the layer that keeps the HTTP contract
 * byte-compatible with what Mongoose `.lean()` produced, so the mobile data client
 * (apps/mobile/lib/stations/stationsClient.ts) needs zero changes:
 *   - emits `_id` (read as `raw.id ?? raw._id`)
 *   - emits `location` as GeoJSON `{ type: "Point", coordinates: [lng, lat] }`
 *   - preserves `connectors[].power`
 */

type ChargerCategory = "ac" | "dc" | "ultra" | "hybrid";

type WireConnector = {
  type: string;
  power?: number;
  status?: string;
  category?: ChargerCategory;
  count?: number;
  pricePerKwh?: number;
  parkingFee?: number;
  currency?: string;
};

export type StationWire = {
  _id: string;
  name: string;
  address?: string;
  location: { type: "Point"; coordinates: [number, number] };
  connectors: WireConnector[];
  workingHours?: string;
  rating?: number;
  description?: string;
  images: string[];
  sources: string[];
  primarySource: string;
  /** Human-facing operator name derived from primarySource (for the brand label). */
  operator: string;
  operatorId: string;
  /** Overall station availability derived from its connectors. */
  status: "available" | "in_use" | "offline" | "unknown";
  /** Charger category for map/detail distinction (high-power DC vs hybrid vs AC). */
  category: ChargerCategory;
  /** Highest connector power in kW (0 if unknown). */
  maxPowerKw: number;
  /** Best-available pricing across connectors, if any source reports it. */
  pricing?: { currency: string; perKwh?: number; parkingFee?: number };
  createdAt: string;
  updatedAt: string;
  distanceMeters?: number;
};

const OPERATOR_NAMES: Record<string, string> = {
  tokbor: "Tokbor",
  "spectre-energy": "Spectre Energy",
  "megawatt-energy": "Megawatt",
  "k-watt": "K-Watt",
  "pro-tok": "Pro-Tok",
  beon: "Beon",
  "yandex-maps": "Yandex Maps",
  "google-maps": "Google Maps",
};

function deriveStatus(connectors: WireConnector[]): StationWire["status"] {
  const statuses = connectors.map((c) => (c.status ?? "").toLowerCase());
  if (statuses.some((s) => s === "available")) return "available";
  if (statuses.some((s) => s === "in_use" || s === "unavailable" || s === "busy")) return "in_use";
  if (statuses.length && statuses.every((s) => s === "offline" || s === "maintenance" || s === "poweroff"))
    return "offline";
  return "unknown";
}

function derivePricing(connectors: WireConnector[]): StationWire["pricing"] {
  const priced = connectors.find((c) => typeof c.pricePerKwh === "number");
  if (!priced) return undefined;
  return {
    currency: priced.currency ?? "UZS",
    perKwh: priced.pricePerKwh,
    parkingFee: priced.parkingFee,
  };
}

function maxPower(connectors: WireConnector[]): number {
  return connectors.reduce((m, c) => Math.max(m, typeof c.power === "number" ? c.power : 0), 0);
}

/** Category from an explicit per-connector hint (e.g. Tokbor HYBRID) else from power. */
function deriveCategory(connectors: WireConnector[], power: number): ChargerCategory {
  const explicit = connectors.find((c) => c.category)?.category;
  if (explicit) return explicit;
  if (power >= 150) return "ultra";
  if (power >= 43) return "dc";
  return "ac";
}

function parseJsonArray<T>(value: unknown): T[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function rowToStation(r: Record<string, any>): StationWire {
  const connectors = parseJsonArray<WireConnector>(r.connectors);
  const primarySource = r.primary_source as string;
  return {
    _id: String(r._id),
    name: r.name,
    address: r.address ?? undefined,
    location: { type: "Point", coordinates: [r.lng, r.lat] },
    connectors,
    workingHours: r.working_hours ?? undefined,
    rating: r.rating ?? undefined,
    description: r.description ?? undefined,
    images: parseJsonArray<string>(r.images),
    sources: parseJsonArray<string>(r.sources),
    primarySource,
    operatorId: primarySource,
    operator: OPERATOR_NAMES[primarySource] ?? primarySource,
    status: deriveStatus(connectors),
    category: deriveCategory(connectors, maxPower(connectors)),
    maxPowerKw: maxPower(connectors),
    pricing: derivePricing(connectors),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
