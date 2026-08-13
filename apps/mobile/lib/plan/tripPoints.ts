import { atom } from 'jotai';

import { PLACES, nearestPlace, type Place } from '@/lib/plan/destinations';

/**
 * The two ends of a trip.
 *
 * A trip end is just a coordinate with a label — it does NOT have to be one of the listed cities.
 * The city chips are a shortcut; dropping a pin on the map is the general case, which matters
 * because people charge at home and at workplaces, not at the geometric centre of Tashkent.
 */

export interface TripPoint {
  lat: number;
  lng: number;
  label: string;
  /** Set when the point came from the city list, so the chip can render as selected. */
  placeId?: string;
}

export function placeToPoint(place: Place): TripPoint {
  return { lat: place.lat, lng: place.lng, label: place.name, placeId: place.id };
}

/** A dropped pin, labelled by the nearest known city so it reads as a place, not a number. */
export function coordToPoint(lat: number, lng: number): TripPoint {
  const near = nearestPlace({ lat, lng });
  return { lat, lng, label: `Pin near ${near.name}` };
}

export function formatPoint(point: TripPoint | null): string {
  if (!point) return '—';
  return point.placeId ? point.label : `${point.label} (${point.lat.toFixed(4)}, ${point.lng.toFixed(4)})`;
}

export const originPointAtom = atom<TripPoint | null>(placeToPoint(PLACES[0]));
export const destPointAtom = atom<TripPoint | null>(null);

/**
 * Which end the map picker is currently choosing. Set before navigating to the picker and read
 * on confirm — expo-router cannot return a value from a pushed screen, so the handoff goes
 * through state rather than through navigation.
 */
export const pickTargetAtom = atom<'from' | 'to'>('from');
