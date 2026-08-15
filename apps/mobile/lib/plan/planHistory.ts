import type { PlanResponse } from '@/lib/plan/planClient';
import { getJson, remove, setJson } from '@/lib/storage/jsonStorage';
import { StorageKeys, planBodyKey } from '@/lib/storage/storageKeys';

/**
 * Saved trips.
 *
 * Every plan the user actually sees is written to disk fully materialized, polyline included,
 * because the stretches where this app earns its keep are the stretches with no signal — the
 * 135 km charger-free run before Qarshi is exactly where a phone stops being able to ask the
 * server anything. A trip that is already under way must not evaporate.
 *
 * The index and the plan bodies are stored under separate keys: the index is small and is read
 * at app start, a body is read only when its trip is reopened.
 */

/**
 * Exactly the navigation params `/plan/results` reads, so a saved trip reopens by replaying them.
 *
 * A type alias rather than an interface on purpose: only aliases get an implicit index signature,
 * and expo-router's params are `Record<string, …>`, so an interface here cannot be handed back to
 * `router.push()` without a cast.
 */
export type TripParams = {
  carId: string;
  fromLat: string;
  fromLng: string;
  fromLabel: string;
  toLat: string;
  toLng: string;
  toLabel: string;
  soc: string;
  style: string;
  temp: string;
};

/** One row of the saved-trip list: enough to render it without reading the plan itself. */
export interface SavedTrip {
  id: string;
  savedAt: string;
  params: TripParams;
  /** Denormalized: the car can be deleted from the garage while its trips remain. */
  carLabel: string;
  feasible: boolean;
  distanceKm: number;
  /** Null when the trip came back infeasible — there is no itinerary to summarize. */
  totalMin: number | null;
  stops: number | null;
}

export interface SavedPlan {
  savedAt: string;
  plan: PlanResponse;
}

/**
 * Cap on stored trips. Each body is ~10 KB, and AsyncStorage on Android is a single SQLite
 * database shared with the station cache, so this stays small on purpose.
 */
const MAX_TRIPS = 12;

/**
 * Identity of a trip: the inputs that change the answer.
 *
 * Labels are deliberately excluded — the same coordinates reached from a city chip and from a
 * dropped pin are the same journey, and should update one row rather than accumulate two.
 */
export function tripId(params: TripParams): string {
  return [
    params.carId,
    params.fromLat,
    params.fromLng,
    params.toLat,
    params.toLng,
    params.soc,
    params.style,
    params.temp,
  ]
    .join('_')
    .replace(/[^A-Za-z0-9._-]/g, '-');
}

function isSavedTrip(value: unknown): value is SavedTrip {
  const trip = value as SavedTrip | null;
  return Boolean(
    trip &&
      typeof trip.id === 'string' &&
      typeof trip.savedAt === 'string' &&
      trip.params &&
      typeof trip.params.carId === 'string' &&
      typeof trip.params.toLat === 'string'
  );
}

/** Newest first. Malformed rows are dropped rather than thrown on — this is disk data. */
export async function loadTrips(): Promise<SavedTrip[]> {
  const stored = await getJson<unknown>(StorageKeys.planIndex);
  return Array.isArray(stored) ? stored.filter(isSavedTrip) : [];
}

/**
 * Persist a plan and return the new index.
 *
 * The body is written before the index, so a failure between the two leaves an orphaned body
 * (harmless, and overwritten on the next save of the same trip) rather than an index row that
 * promises a plan which cannot be opened — the one failure this module exists to prevent.
 */
export async function saveTrip(
  trip: Omit<SavedTrip, 'savedAt'>,
  plan: PlanResponse
): Promise<SavedTrip[]> {
  const saved: SavedTrip = { ...trip, savedAt: new Date().toISOString() };
  const existing = await loadTrips();
  const next = [saved, ...existing.filter((t) => t.id !== saved.id)];
  const kept = next.slice(0, MAX_TRIPS);

  await setJson<SavedPlan>(planBodyKey(saved.id), { savedAt: saved.savedAt, plan });
  await setJson(StorageKeys.planIndex, kept);

  await Promise.all(
    next.slice(MAX_TRIPS).map((dropped) => remove(planBodyKey(dropped.id)).catch(() => undefined))
  );

  return kept;
}

export async function loadSavedPlan(id: string): Promise<SavedPlan | null> {
  const body = await getJson<SavedPlan>(planBodyKey(id));
  return body?.plan ? body : null;
}

/**
 * How a saved plan disagrees with the car as it is configured today, if it does.
 *
 * A trip is keyed by the car's *id*, so editing that car in the garage leaves the saved plan in
 * place, computed against the old numbers. Online that is invisible — the fresh answer replaces
 * it. Offline it is not: without this check the app would hand a driver an itinerary built for a
 * connector their car does not have, under a banner whose only caveat is charger availability.
 *
 * A plug change is `blocking`, because GB/T and CCS2 are physically different sockets and the two
 * networks barely overlap — such a plan is not stale, it is wrong. Everything else is a caveat:
 * the route still exists, its margins were just sized for a different car.
 */
export function describeSpecDrift(
  plan: PlanResponse,
  car: { plug: string | null; rangeKm: number; consWhKm: number; dcPeakKw: number; curvePreset: string }
): { blocking: boolean; message: string } | null {
  const stored = plan.vehicle;
  if (car.plug && stored.plug && stored.plug !== car.plug) {
    return {
      blocking: true,
      message:
        'This plan was worked out for a different connector than your car now has, so its charging stops may not physically fit. Reconnect to plan it again.',
    };
  }

  // Every figure is compared against what the request actually sent, not the raw garage value:
  // `buildPlanUrl` rounds range, dcKw and consWhKm to whole numbers on the way out and the server
  // echoes those, so a car with dcPeakKw 87.5 would otherwise be flagged as "changed" against
  // its own plan forever. Sub-unit differences are not something a driver needs a warning about.
  const changed: string[] = [];
  if (Math.abs(stored.rangeKm - car.rangeKm) > 1) changed.push('range');
  if (stored.assumed.dcPeakKw !== Math.round(car.dcPeakKw)) changed.push('charging speed');
  if (stored.assumed.consWhKm !== Math.round(car.consWhKm)) changed.push('efficiency');
  if (stored.assumed.curve !== car.curvePreset) changed.push('battery type');
  if (!changed.length) return null;

  return {
    blocking: false,
    message: `Your car's ${changed.join(' and ')} changed since this was planned, so its margins were sized for the old figures.`,
  };
}

export async function deleteTrip(id: string): Promise<SavedTrip[]> {
  const kept = (await loadTrips()).filter((trip) => trip.id !== id);
  await setJson(StorageKeys.planIndex, kept);
  await remove(planBodyKey(id)).catch(() => undefined);
  return kept;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * How long ago a plan was saved, in words.
 *
 * Formatted by hand rather than through `Intl`, which is not guaranteed on every Hermes build,
 * and this string is load-bearing: it is what tells the driver the plan in front of them is a
 * remembered one rather than a live answer.
 */
export function formatSavedAt(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'earlier';

  const minutes = (Date.now() - at.getTime()) / 60_000;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  if (minutes < 24 * 60) {
    const hours = Math.round(minutes / 60);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  if (minutes < 48 * 60) return 'yesterday';
  return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}
