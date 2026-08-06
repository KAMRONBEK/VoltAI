import fs from "node:fs";
import path from "node:path";

/**
 * On-disk cache of per-station Tokbor detail (name/address/price/power), keyed by station id.
 * The list endpoint (/charging-station) has none of this — only /charging-station/{id} does — so
 * we fetch details ONCE (npm run enrich:tokbor) and cache them; the scraper then merges the cached
 * detail with the live list on every cron tick. File lives in data/ (gitignored).
 */
export interface TokborDetail {
  name?: string;
  address?: string;
  capacity?: number; // kW
  electricityFee?: number; // per kWh
  idleFee?: number; // parking/idle
  connectorCount?: number;
}

let cache: Map<string, TokborDetail> | null = null;

function cachePath(): string {
  return process.env.TOKBOR_DETAILS_PATH ?? path.join(process.cwd(), "data", "tokbor-details.json");
}

export function loadTokborDetails(): Map<string, TokborDetail> {
  if (cache) return cache;
  try {
    const obj = JSON.parse(fs.readFileSync(cachePath(), "utf8")) as Record<string, TokborDetail>;
    cache = new Map(Object.entries(obj));
  } catch {
    cache = new Map();
  }
  return cache;
}

export function getTokborDetail(id: string | number): TokborDetail | undefined {
  return loadTokborDetails().get(String(id));
}

export function saveTokborDetails(map: Record<string, TokborDetail>): void {
  const file = cachePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(map));
  cache = new Map(Object.entries(map));
}
