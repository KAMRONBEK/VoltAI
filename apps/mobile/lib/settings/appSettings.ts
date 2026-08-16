import { atom, getDefaultStore, useAtom } from 'jotai';
import { useCallback, useEffect } from 'react';

import { getJson, setJson } from '@/lib/storage/jsonStorage';
import { StorageKeys } from '@/lib/storage/storageKeys';

/**
 * Device-local app settings. The app is account-free: everything the user configures lives
 * on this device via AsyncStorage, nothing is synced to a server. Add new preferences here
 * and they'll merge over the defaults on load.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * Destination arrival reserve, percent of planning range. Sent to `/api/plan` as `reservePct`;
 * the planner keeps at least this much battery (never less than 25 km) at the destination and
 * refuses any plan whose last leg would end below it. Three steps rather than a slider: the
 * server accepts 10–40, but below 15 the reserve stops being one and above 25 the extra charging
 * time buys nothing on the corridors this app covers.
 */
export type ArrivalReservePct = 15 | 20 | 25;

export const ARRIVAL_RESERVE_OPTIONS: readonly ArrivalReservePct[] = [15, 20, 25];

/** The planner's own default (`DEFAULT_RESERVE_PCT` in the API), repeated here so the app agrees. */
export const DEFAULT_ARRIVAL_RESERVE_PCT: ArrivalReservePct = 20;

export type AppSettings = {
  /** 'system' follows the OS; 'light'/'dark' force a scheme. */
  themePreference: ThemePreference;
  /** "Arrive with at least N %" — see `ArrivalReservePct`. */
  arrivalReservePct: ArrivalReservePct;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  themePreference: 'system',
  arrivalReservePct: DEFAULT_ARRIVAL_RESERVE_PCT,
};

function isArrivalReservePct(value: unknown): value is ArrivalReservePct {
  return (ARRIVAL_RESERVE_OPTIONS as readonly unknown[]).includes(value);
}

export async function loadAppSettings(): Promise<AppSettings> {
  const stored = await getJson<Partial<AppSettings>>(StorageKeys.appSettings);
  const merged = { ...DEFAULT_APP_SETTINGS, ...(stored ?? {}) };
  // A value written by a build that offered different steps must not be sent to the server
  // as-is: the API refuses anything outside 10-40 with a 400 the trip screen cannot explain.
  if (!isArrivalReservePct(merged.arrivalReservePct)) {
    merged.arrivalReservePct = DEFAULT_ARRIVAL_RESERVE_PCT;
  }
  return merged;
}

/**
 * Writes are serialized so two settings changed in quick succession cannot lose each other:
 * each save reads what is on disk, merges the patch and writes the whole object back.
 */
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Persist a change. Takes a PATCH, not the whole object, because the theme provider and the
 * trip-planning setting each own one field and neither should have to know about the other
 * to avoid overwriting it.
 */
export function saveAppSettings(patch: Partial<AppSettings>): Promise<void> {
  const write = writeQueue.then(async () => {
    const current = await loadAppSettings();
    await setJson(StorageKeys.appSettings, { ...current, ...patch });
  });
  // The queue itself must never reject, or every later write would be skipped too.
  writeQueue = write.catch(() => undefined);
  return write;
}

// ---------------------------------------------------------------------------------------------
// Arrival reserve as a jotai atom.
//
// The theme preference lives in a React Context (`lib/theme/theme-context.tsx`) because the
// splash waits on it; this one has no such constraint, so it follows the garage and the trip
// history: a module-level atom on jotai's default store, hydrated once from AsyncStorage on
// first use, writes persisted best-effort. Hydration is lazy (first hook mount or first
// `getArrivalReservePct()` call) rather than wired into `app/_layout.tsx`, so a plan request
// fired from any screen — including a saved trip reopened cold — still reads the stored value.
// ---------------------------------------------------------------------------------------------

const arrivalReservePctAtom = atom<ArrivalReservePct>(DEFAULT_ARRIVAL_RESERVE_PCT);

let hydration: Promise<void> | null = null;
/** True once the user has changed the value this session: a late-arriving disk read must not undo it. */
let userWrote = false;

function hydrateArrivalReserve(): Promise<void> {
  if (!hydration) {
    hydration = loadAppSettings()
      .then((s) => {
        if (!userWrote) getDefaultStore().set(arrivalReservePctAtom, s.arrivalReservePct);
      })
      // A failed read just means the default is used until the user sets it again.
      .catch(() => undefined);
  }
  return hydration;
}

/**
 * The persisted arrival reserve, for a plan request. Waits for the stored value on first call so
 * the very first plan after a cold start already uses the user's choice, not the default.
 */
export async function getArrivalReservePct(): Promise<ArrivalReservePct> {
  await hydrateArrivalReserve();
  return getDefaultStore().get(arrivalReservePctAtom);
}

/** `[value, set]` for the Settings screen and anywhere that echoes the reserve back to the user. */
export function useArrivalReservePct(): [ArrivalReservePct, (value: ArrivalReservePct) => void] {
  const [value, setValue] = useAtom(arrivalReservePctAtom);
  useEffect(() => {
    void hydrateArrivalReserve();
  }, []);
  const set = useCallback(
    (next: ArrivalReservePct) => {
      userWrote = true;
      setValue(next);
      // Best-effort persist; a failed write just means the choice isn't remembered next launch.
      void saveAppSettings({ arrivalReservePct: next });
    },
    [setValue]
  );
  return [value, set];
}
