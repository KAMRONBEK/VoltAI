/**
 * Intercity destinations offered by the trip planner.
 *
 * A fixed list rather than a search box: MapKit's `lite` flavor has no geocoding or suggest (those
 * are full-flavor only), the Yandex geocoding key is dead and Google billing is off — so there is
 * no address lookup available. Intercity EV trips in Uzbekistan are city-to-city anyway, and a
 * curated list is faster to use than a search box that would mostly disappoint.
 */

export interface Place {
  id: string;
  name: string;
  region?: string;
  lat: number;
  lng: number;
}

export const PLACES: Place[] = [
  { id: 'tashkent', name: 'Tashkent', lat: 41.311081, lng: 69.240562 },
  { id: 'samarkand', name: 'Samarkand', lat: 39.654321, lng: 66.959724 },
  { id: 'bukhara', name: 'Bukhara', lat: 39.767072, lng: 64.421242 },
  { id: 'qarshi', name: 'Qarshi', region: 'Qashqadaryo', lat: 38.861034, lng: 65.78903 },
  { id: 'jizzakh', name: 'Jizzakh', lat: 40.115501, lng: 67.842205 },
  { id: 'guliston', name: 'Guliston', lat: 40.489399, lng: 68.78415 },
  { id: 'navoiy', name: 'Navoiy', lat: 40.084146, lng: 65.379005 },
  { id: 'termez', name: 'Termez', region: 'Surxondaryo', lat: 37.224443, lng: 67.278122 },
  { id: 'shahrisabz', name: 'Shahrisabz', lat: 39.057999, lng: 66.833 },
  { id: 'urgench', name: 'Urgench', lat: 41.550205, lng: 60.631523 },
  { id: 'khiva', name: 'Khiva', lat: 41.378601, lng: 60.363602 },
  { id: 'nukus', name: 'Nukus', region: 'Karakalpakstan', lat: 42.460266, lng: 59.617126 },
  { id: 'fergana', name: 'Fergana', lat: 40.386681, lng: 71.783279 },
  { id: 'namangan', name: 'Namangan', lat: 40.998497, lng: 71.671295 },
  { id: 'andijan', name: 'Andijan', lat: 40.783363, lng: 72.350281 },
  { id: 'nurafshon', name: 'Nurafshon', lat: 41.019722, lng: 69.343056 },
];

export function findPlace(id: string | null | undefined): Place | null {
  if (!id) return null;
  return PLACES.find((p) => p.id === id) ?? null;
}

const EARTH_R_KM = 6371;

/** Straight-line distance, used only to pick the nearest city as a default origin. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.sqrt(s));
}

export function nearestPlace(point: { lat: number; lng: number }): Place {
  let best = PLACES[0];
  let bestKm = Infinity;
  for (const place of PLACES) {
    const km = haversineKm(point, place);
    if (km < bestKm) {
      bestKm = km;
      best = place;
    }
  }
  return best;
}
