import { atom, useSetAtom } from 'jotai';
import { useEffect } from 'react';

import type { PlanResponse } from '@/lib/plan/planClient';
import {
  deleteTrip,
  loadTrips,
  saveTrip,
  type SavedTrip,
} from '@/lib/plan/planHistory';

/**
 * Saved trips as jotai atoms, mirroring `garage-atoms.ts`: hydration is explicit, and every
 * write goes to disk first so the in-memory list can never claim a trip the disk does not have.
 */

const tripsAtom = atom<SavedTrip[]>([]);

/** Newest first. Empty until hydration finishes. */
export const savedTripsAtom = atom((get) => get(tripsAtom));

export const tripsLoadedAtom = atom(false);

export const saveTripAtom = atom(
  null,
  async (_get, set, input: { trip: Omit<SavedTrip, 'savedAt'>; plan: PlanResponse }) => {
    try {
      set(tripsAtom, await saveTrip(input.trip, input.plan));
    } catch {
      // A trip that could not be written is only a trip that will not be remembered; the plan
      // on screen is unaffected, so this must never surface as an error.
    }
  }
);

export const deleteTripAtom = atom(null, async (_get, set, id: string) => {
  try {
    set(tripsAtom, await deleteTrip(id));
  } catch {
    // Same reasoning as above: the list simply stays as it was.
  }
});

const hydrateTripsAtom = atom(null, async (_get, set) => {
  try {
    set(tripsAtom, await loadTrips());
  } catch {
    // An unreadable index is an empty history, not a crash on launch.
  } finally {
    set(tripsLoadedAtom, true);
  }
});

/** Read the saved-trip index once, at app start. Mount exactly once, above anything that reads it. */
export function useHydratePlanHistory(): void {
  const hydrate = useSetAtom(hydrateTripsAtom);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
}
