import type { ImageSourcePropType } from 'react-native';
import type { StationStatus } from '@/types/stations';

/**
 * Pre-composited map marker images (operator logo + availability ring + status pip),
 * one per operator × status. Using the native Marker `source` (static images) instead of
 * React-child markers is reliable (no snapshot/async-image race) and fast for ~1.5k pins.
 */
const MARKERS: Record<string, ImageSourcePropType> = {
  'tokbor-available': require('../assets/operators/markers/tokbor-available.png'),
  'tokbor-in_use': require('../assets/operators/markers/tokbor-in_use.png'),
  'tokbor-offline': require('../assets/operators/markers/tokbor-offline.png'),
  'tokbor-unknown': require('../assets/operators/markers/tokbor-unknown.png'),
  'spectre-energy-available': require('../assets/operators/markers/spectre-energy-available.png'),
  'spectre-energy-in_use': require('../assets/operators/markers/spectre-energy-in_use.png'),
  'spectre-energy-offline': require('../assets/operators/markers/spectre-energy-offline.png'),
  'spectre-energy-unknown': require('../assets/operators/markers/spectre-energy-unknown.png'),
  'k-watt-available': require('../assets/operators/markers/k-watt-available.png'),
  'k-watt-in_use': require('../assets/operators/markers/k-watt-in_use.png'),
  'k-watt-offline': require('../assets/operators/markers/k-watt-offline.png'),
  'k-watt-unknown': require('../assets/operators/markers/k-watt-unknown.png'),
  'generic-available': require('../assets/operators/markers/generic-available.png'),
  'generic-in_use': require('../assets/operators/markers/generic-in_use.png'),
  'generic-offline': require('../assets/operators/markers/generic-offline.png'),
  'generic-unknown': require('../assets/operators/markers/generic-unknown.png'),
};

export function markerImage(operatorId: string | undefined, status: StationStatus): ImageSourcePropType {
  return MARKERS[`${operatorId}-${status}`] ?? MARKERS[`generic-${status}`] ?? MARKERS['generic-unknown'];
}
