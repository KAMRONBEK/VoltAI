import type { ImageSourcePropType } from 'react-native';

/**
 * Charger operator brand registry. `id` matches the API's `operatorId`/`primarySource`.
 * Logos were extracted from each operator's own app (launcher icons) and normalized to
 * 96px PNGs in assets/operators/. Colors are sampled from those logos.
 */
export interface OperatorInfo {
  id: string;
  name: string;
  color: string;
  logo?: ImageSourcePropType;
}

const LOGOS: Record<string, ImageSourcePropType> = {
  tokbor: require('../assets/operators/tokbor.png'),
  'spectre-energy': require('../assets/operators/spectre-energy.png'),
  'k-watt': require('../assets/operators/k-watt.png'),
};

export const OPERATORS: Record<string, OperatorInfo> = {
  tokbor: { id: 'tokbor', name: 'Tokbor', color: '#1AA63F', logo: LOGOS.tokbor },
  'spectre-energy': { id: 'spectre-energy', name: 'Spectre Energy', color: '#3F45E8', logo: LOGOS['spectre-energy'] },
  'k-watt': { id: 'k-watt', name: 'K-Watt', color: '#1E9E52', logo: LOGOS['k-watt'] },
  'megawatt-energy': { id: 'megawatt-energy', name: 'Megawatt', color: '#06BAB5' },
  'pro-tok': { id: 'pro-tok', name: 'Pro-Tok', color: '#E8A33F' },
  beon: { id: 'beon', name: 'Beon', color: '#7C4DFF' },
};

const FALLBACK: OperatorInfo = { id: 'unknown', name: 'Charger', color: '#8A8F98' };

export function operatorFor(id?: string | null): OperatorInfo {
  if (id && OPERATORS[id]) return OPERATORS[id];
  return id ? { ...FALLBACK, id, name: id } : FALLBACK;
}
