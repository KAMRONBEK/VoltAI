import type { ChargerCategory } from '@/types/stations';

/**
 * Charger category presentation — the high-power / hybrid / AC distinction the map and
 * detail sheet use. Colors double as the marker ring color so category reads at a glance.
 */
export interface CategoryInfo {
  id: ChargerCategory;
  label: string;
  short: string;
  color: string;
}

export const CATEGORIES: Record<ChargerCategory, CategoryInfo> = {
  ultra: { id: 'ultra', label: 'Ultra-fast', short: 'ULTRA', color: '#A855F7' }, // purple
  dc: { id: 'dc', label: 'DC Fast', short: 'DC', color: '#3FA9F5' }, // blue
  hybrid: { id: 'hybrid', label: 'Hybrid', short: 'HYBRID', color: '#14D6C4' }, // teal
  ac: { id: 'ac', label: 'AC', short: 'AC', color: '#9AA3AD' }, // grey
};

export function categoryInfo(category?: ChargerCategory | null): CategoryInfo {
  return (category && CATEGORIES[category]) || CATEGORIES.dc;
}
