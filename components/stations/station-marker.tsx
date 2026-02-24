import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import type { StationStatus } from '@/types/stations';

type Props = {
  status: StationStatus;
  selected?: boolean;
  onFirstLayout?: () => void;
};

function statusColor(status: StationStatus): string {
  switch (status) {
    case 'available':
      return '#2FE28A';
    case 'in_use':
      return '#F7B84B';
    case 'offline':
      return '#6D6D6D';
    default:
      return '#4DB5FF';
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // Expect #RRGGBB
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return { r, g, b };
}

function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
}

export function StationMarker({ status, selected = false, onFirstLayout }: Props) {
  const accent = statusColor(status);

  const selectedScale = selected ? (Platform.OS === 'android' ? 1 : 1.06) : 1;

  return (
    <View
      collapsable={false}
      style={[styles.wrap, selected ? styles.wrapSelected : null, { transform: [{ scale: selectedScale }] }]}
      onLayout={(e: LayoutChangeEvent) => {
        if (e.nativeEvent.layout.height > 0) onFirstLayout?.();
      }}>
      {/* Circle marker only (Android-safe) */}
      <View
        style={[
          styles.circle,
          { borderColor: withAlpha(accent, 0.9), backgroundColor: '#0F1114' },
          selected ? { shadowColor: accent } : null,
        ]}>
        <View style={[styles.circleInner, { backgroundColor: withAlpha(accent, 0.14) }]}>
          <MaterialIcons name="bolt" size={12} color={accent} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    // Android custom markers are often snapshotted into a square-ish bitmap.
    // Keep the full visual inside a 44x44 footprint to avoid cut-off.
    height: 36,
  },
  wrapSelected: {
    // Intentionally empty: selection is expressed via scale in render (iOS only),
    // and via color/halo changes (Android-safe).
  },
  circle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.22,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
      },
      android: {
        elevation: 6,
      },
      default: {},
    }),
  },
  circleInner: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

