export const StorageKeys = {
  /** Superseded by `garage` — still read once, to migrate the old single-vehicle profile. */
  vehicleProfile: 'voltai.vehicleProfile.v1',
  garage: 'voltai.garage.v1',
  stationsCache: 'voltai.stationsCache.v1',
  appSettings: 'voltai.appSettings.v1',
  /** Index of saved trips. The plans themselves live under `planBodyKey()`. */
  planIndex: 'voltai.plans.v1',
  /** Last good `GET /api/client-config` body — used when the fetch at launch fails. */
  clientConfig: 'voltai.clientConfig.v1',
  /** Hash of the last server `message` the user has already been shown. */
  clientMessageSeen: 'voltai.clientMessageSeen.v1',
} as const;

/**
 * Where one saved plan is stored.
 *
 * Kept out of the index because a materialized plan is mostly polyline — roughly 10 KB each —
 * and the index is read at every app start, while a plan is read only when its trip is reopened.
 */
export function planBodyKey(id: string): string {
  return `voltai.plan.${id}.v1`;
}
