import { getJson, setJson } from '@/lib/storage/jsonStorage';
import { StorageKeys } from '@/lib/storage/storageKeys';
import { loadVehicleProfile } from '@/lib/vehicles/vehicleProfile';

/**
 * The user's saved cars. Device-local, no account — same posture as the rest of the app.
 *
 * The important field here is `plug`. Uzbekistan's DC network is overwhelmingly GB/T (roughly
 * 1000 routable GB/T sites against ~110 CCS2), so the two networks are nearly disjoint. Guessing
 * the plug does not produce a slightly-worse route, it produces a route to sockets that physically
 * do not fit the car — which is why it is nullable here and blocks planning until answered,
 * rather than being defaulted to the common case.
 */

export type Plug = 'GBT_DC' | 'CCS2' | 'CCS1' | 'NACS' | 'CHADEMO';

export const PLUG_OPTIONS: { value: Plug; label: string; hint: string }[] = [
  { value: 'GBT_DC', label: 'GB/T', hint: 'BYD and most Chinese EVs — by far the most common here' },
  { value: 'CCS2', label: 'CCS2', hint: 'Most European EVs — far fewer chargers in Uzbekistan' },
  { value: 'NACS', label: 'NACS', hint: 'Tesla (North American connector)' },
  { value: 'CCS1', label: 'CCS1', hint: 'US-market imports' },
  { value: 'CHADEMO', label: 'CHAdeMO', hint: 'Older Nissan Leaf and similar' },
];

/** Battery chemistry shorthand, which sets how sharply charging slows near the top. */
export type CurvePreset = 'lfp' | 'standard' | 'peaky';

export const CURVE_OPTIONS: { value: CurvePreset; label: string; hint: string }[] = [
  { value: 'lfp', label: 'LFP', hint: 'Holds full speed longest (BYD Blade and similar)' },
  { value: 'standard', label: 'Standard', hint: 'Typical — pick this if unsure' },
  { value: 'peaky', label: 'Fast then slow', hint: 'Quick at low charge, tapers early' },
];

export type RangeSource = 'observed' | 'sticker';

export interface SavedCar {
  id: string;
  label: string;
  /** Real-world km at 100%, mild weather, mostly highway. Already adjusted if entered as sticker. */
  rangeKm: number;
  rangeSource: RangeSource;
  /** null means "not answered yet" — the car cannot be planned with until this is set. */
  plug: Plug | null;
  dcPeakKw: number;
  consWhKm: number;
  curvePreset: CurvePreset;
  createdAt: string;
  updatedAt: string;
}

export interface Garage {
  cars: SavedCar[];
  selectedCarId: string | null;
  schema: 1;
}

export const EMPTY_GARAGE: Garage = { cars: [], selectedCarId: null, schema: 1 };

/** Manufacturer range figures (CLTC especially) overstate real-world by roughly 30-45%. */
export const STICKER_TO_REAL = 0.72;

export const DEFAULT_DC_PEAK_KW = 90;
export const DEFAULT_CONS_WH_KM = 180;

/**
 * A car can only be planned with once we know what it plugs into.
 *
 * Deliberately a plain boolean rather than a `car is SavedCar` predicate: negating such a
 * predicate narrows an already-non-null car to `never`, so `!isPlannable(car)` branches lose
 * access to the car they are about to complain about.
 */
export function isPlannable(car: SavedCar | null | undefined): boolean {
  return Boolean(car && car.plug);
}

/** The real-world range we plan against, after adjusting a sticker figure down. */
export function effectiveRangeKm(car: Pick<SavedCar, 'rangeKm' | 'rangeSource'>): number {
  return car.rangeSource === 'sticker' ? Math.round(car.rangeKm * STICKER_TO_REAL) : car.rangeKm;
}

/**
 * Derived figures, echoed back on the form so the numbers behind a plan are never hidden.
 * Pack size follows from range and consumption; we never ask the user for kWh.
 */
export function derivedSpec(car: Pick<SavedCar, 'rangeKm' | 'rangeSource' | 'consWhKm' | 'dcPeakKw'>) {
  const realRange = effectiveRangeKm(car);
  return {
    realRangeKm: realRange,
    packKwh: Math.round((realRange * car.consWhKm) / 100) / 10,
    dcPeakKw: car.dcPeakKw,
  };
}

function newId(): string {
  return `car_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function blankCar(): SavedCar {
  const now = new Date().toISOString();
  return {
    id: newId(),
    label: '',
    rangeKm: 0,
    rangeSource: 'observed',
    plug: null,
    dcPeakKw: DEFAULT_DC_PEAK_KW,
    consWhKm: DEFAULT_CONS_WH_KM,
    curvePreset: 'standard',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Load the garage, migrating the older single-vehicle profile on first run.
 *
 * The migrated car deliberately gets `plug: null`. The old profile was {make, model, rangeKm} and
 * never captured a connector, so seeding a plug here would silently assert something we were never
 * told — and for a CCS2 owner that assertion routes them through chargers that do not fit.
 */
export async function loadGarage(): Promise<Garage> {
  const stored = await getJson<Garage>(StorageKeys.garage);
  if (stored && Array.isArray(stored.cars)) return stored;

  const legacy = await loadVehicleProfile();
  if (legacy && legacy.rangeKm > 0) {
    const car = blankCar();
    car.label = [legacy.make, legacy.model].filter(Boolean).join(' ').trim() || 'My car';
    car.rangeKm = legacy.rangeKm;
    const migrated: Garage = { cars: [car], selectedCarId: car.id, schema: 1 };
    await setJson(StorageKeys.garage, migrated);
    return migrated;
  }

  return EMPTY_GARAGE;
}

export async function saveGarage(garage: Garage): Promise<void> {
  await setJson(StorageKeys.garage, garage);
}
