import type { Plug } from '@/lib/vehicles/garage';

/**
 * Client for `GET /api/plan`.
 *
 * Read-only and cacheable, so it is a plain GET with everything in the query string — the server
 * answers repeats from its cache and the edge absorbs the rest, which matters because the origin
 * is a single phone.
 */

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.voltai.uz';

/** Long enough for a cold plan (which includes a routing call), short enough to fail visibly. */
const TIMEOUT_MS = 20_000;

export interface PlanChargingStop {
  siteId: string;
  name: string;
  lat: number;
  lng: number;
  progressKm: number;
  lateralKm: number;
  arriveSocPct: number;
  departSocPct: number;
  chargeMin: number;
  gunKw: number | null;
  powerConfidence: 'explicit' | 'inferred';
  liveStatus: 'available' | 'busy' | 'offline' | 'unknown';
  gatekeeper: boolean;
}

export interface PlanOption {
  id: 'fastest' | 'fewest-stops' | 'most-buffer';
  totalMin: number;
  driveMin: number;
  chargeMin: number;
  plugMin: number;
  distanceKm: number;
  stops: number;
  arriveSocPct: number;
  minSocPct: number;
  chargingStops: PlanChargingStop[];
  geometry: { source: string };
}

export interface PlanResponse {
  dataAsOf: string | null;
  dataAgeSec: number | null;
  feasible: boolean;
  geometry: 'routed' | 'cached' | 'corridor' | 'estimated';
  geometryTrusted: boolean;
  routingError: { reason: string; detail?: string } | null;
  distanceKm: number;
  vehicle: {
    rangeKm: number;
    planningRangeKm: number;
    plug: string;
    assumed: {
      consWhKm: number;
      packKwh: number;
      dcPeakKw: number;
      curve: string;
      style: string;
      temp: string;
    };
  };
  relaxations: string[];
  diagnostics: {
    computeMs: number;
    candidates: { onCorridor: number; considered: number };
    gatekeepers: number;
    unverifiedGatekeepers: number;
    paretoCapHit: boolean;
    labelsGenerated: number;
  };
  options: PlanOption[];
  unverified: { id: string; name: string; lat: number; lng: number; reason: string }[];
  blockingGap: {
    fromKm: number;
    toKm: number;
    gapKm: number;
    endsAtDestination: boolean;
    reason: string;
  } | null;
  suggestions?: string[];
  /** Encoded route geometry, attached client-side from the response payload when present. */
  polyline?: string;
}

export interface PlanRequest {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  rangeKm: number;
  startSocPct: number;
  plug: Plug;
  dcKw: number;
  consWhKm: number;
  curve: string;
  style: 'relaxed' | 'normal' | 'fast';
  temp: 'mild' | 'winter';
  live?: boolean;
}

export class PlanError extends Error {
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.reason = reason;
  }
}

export function buildPlanUrl(req: PlanRequest): string {
  const q = new URLSearchParams({
    from: `${req.from.lat.toFixed(5)},${req.from.lng.toFixed(5)}`,
    to: `${req.to.lat.toFixed(5)},${req.to.lng.toFixed(5)}`,
    range: String(Math.round(req.rangeKm)),
    soc: String(Math.round(req.startSocPct)),
    plug: req.plug,
    dcKw: String(Math.round(req.dcKw)),
    consWhKm: String(Math.round(req.consWhKm)),
    curve: req.curve,
    style: req.style,
    temp: req.temp,
    live: req.live === false ? '0' : '1',
  });
  return `${API_BASE_URL}/api/plan?${q.toString()}`;
}

export async function fetchPlan(req: PlanRequest): Promise<PlanResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(buildPlanUrl(req), { signal: controller.signal });

    if (res.status === 503) {
      throw new PlanError('The planner is busy right now. Try again in a moment.', 'busy');
    }
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { message?: string; reason?: string } | null;
      throw new PlanError(body?.message ?? 'That trip could not be read.', body?.reason ?? 'bad-request');
    }
    if (!res.ok) {
      throw new PlanError(`The planner is unavailable (HTTP ${res.status}).`, 'http');
    }

    return (await res.json()) as PlanResponse;
  } catch (error) {
    if (error instanceof PlanError) throw error;
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new PlanError(
      aborted
        ? 'The planner took too long to answer. Check your connection and try again.'
        : 'Could not reach the planner. Check your connection and try again.',
      aborted ? 'timeout' : 'network'
    );
  } finally {
    clearTimeout(timer);
  }
}

export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/**
 * Charging speed for one stop, as km of range gained per hour.
 *
 * Derived from the stop the planner actually produced — range added divided by the minutes it
 * budgeted — rather than from the gun's rating. The rating is the wrong number twice over: it
 * ignores the car's own DC ceiling (a 200 kW gun gives a 90 kW car 90 kW) and it ignores the
 * taper, so quoting it told a driver "adds 1111 km per hour" for a stop this same screen says
 * takes 14 minutes to add 89 km. This figure agrees with the itinerary because it comes from it.
 */
export function stopKmPerHour(stop: PlanChargingStop, planningRangeKm: number): number | null {
  if (stop.chargeMin <= 0 || planningRangeKm <= 0) return null;
  const kmAdded = ((stop.departSocPct - stop.arriveSocPct) / 100) * planningRangeKm;
  if (kmAdded <= 0) return null;
  return Math.round(kmAdded / (stop.chargeMin / 60));
}

/**
 * The power this car will actually draw here: the lower of the gun and the car's DC ceiling.
 * `carLimited` is what lets the UI explain a number that is smaller than the sign on the charger.
 */
export function effectivePowerKw(
  gunKw: number | null,
  dcPeakKw: number
): { kw: number; carLimited: boolean } | null {
  if (!gunKw || gunKw <= 0) return null;
  if (!dcPeakKw || dcPeakKw <= 0) return { kw: gunKw, carLimited: false };
  return { kw: Math.min(gunKw, dcPeakKw), carLimited: dcPeakKw < gunKw };
}
