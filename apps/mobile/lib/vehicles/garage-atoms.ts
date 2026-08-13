import { atom, useSetAtom } from 'jotai';
import { useEffect } from 'react';

import {
  EMPTY_GARAGE,
  loadGarage,
  saveGarage,
  type Garage,
  type SavedCar,
} from '@/lib/vehicles/garage';

/**
 * Garage state as jotai atoms.
 *
 * Hydration is explicit rather than using `atomWithStorage`: AsyncStorage is async, so
 * `atomWithStorage` would make every read suspend, and suspending the root on a disk read is a
 * worse trade than a short `isLoaded === false` window the screens already handle. Writes persist
 * best-effort — a failed write only means the change is not remembered next launch.
 */

const garageAtom = atom<Garage>(EMPTY_GARAGE);

/** False until the stored garage (and any legacy profile migration) has been read. */
export const garageLoadedAtom = atom(false);

export const carsAtom = atom((get) => get(garageAtom).cars);

/**
 * The car planning uses. Falls back to the first saved car so a garage with exactly one car works
 * without the user ever having explicitly "selected" it.
 */
export const selectedCarAtom = atom<SavedCar | null>((get) => {
  const { cars, selectedCarId } = get(garageAtom);
  return cars.find((car) => car.id === selectedCarId) ?? cars[0] ?? null;
});

/** Read-only lookup by id, for the edit screen and the results screen's stored carId. */
export const carByIdAtom = atom((get) => {
  const { cars } = get(garageAtom);
  return (id: string): SavedCar | null => cars.find((car) => car.id === id) ?? null;
});

function persist(next: Garage): Garage {
  void saveGarage(next);
  return next;
}

export const addCarAtom = atom(null, (get, set, car: SavedCar) => {
  const prev = get(garageAtom);
  // The first car added becomes the selected one, so planning works without a second tap.
  set(
    garageAtom,
    persist({ ...prev, cars: [...prev.cars, car], selectedCarId: prev.selectedCarId ?? car.id })
  );
});

export const updateCarAtom = atom(null, (get, set, car: SavedCar) => {
  const prev = get(garageAtom);
  set(
    garageAtom,
    persist({ ...prev, cars: prev.cars.map((existing) => (existing.id === car.id ? car : existing)) })
  );
});

export const removeCarAtom = atom(null, (get, set, id: string) => {
  const prev = get(garageAtom);
  const cars = prev.cars.filter((car) => car.id !== id);
  set(
    garageAtom,
    persist({
      ...prev,
      cars,
      selectedCarId: prev.selectedCarId === id ? (cars[0]?.id ?? null) : prev.selectedCarId,
    })
  );
});

export const selectCarAtom = atom(null, (get, set, id: string) => {
  set(garageAtom, persist({ ...get(garageAtom), selectedCarId: id }));
});

const hydrateGarageAtom = atom(null, async (_get, set) => {
  const garage = await loadGarage();
  set(garageAtom, garage);
  set(garageLoadedAtom, true);
});

/**
 * Read the stored garage once, at app start. Mount this exactly once, above anything that reads
 * the garage — `app/_layout.tsx` does.
 */
export function useHydrateGarage(): void {
  const hydrate = useSetAtom(hydrateGarageAtom);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
}
