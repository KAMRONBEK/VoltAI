import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import type { StationStatus } from '@/types/stations';

type Props = {
  statuses: StationStatus[]; // 1 or 2
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

function statusDotColor(status: StationStatus): string {
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

function primaryAccent(statuses: StationStatus[]): string {
  // Prefer availability signal as the primary accent.
  if (statuses.includes('available')) return statusColor('available');
  if (statuses.includes('in_use')) return statusColor('in_use');
  if (statuses.includes('offline')) return statusColor('offline');
  return statusColor('unknown');
}

export function StationMarker({ statuses, selected = false, onFirstLayout }: Props) {
  const accent = primaryAccent(statuses);
  const splitA = statuses[0] ? statusDotColor(statuses[0]) : accent;
  const splitB = statuses[1] ? statusDotColor(statuses[1]) : accent;
  const isDual = statuses.length > 1;

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
          {
            borderColor: isDual ? 'rgba(255,255,255,0.18)' : withAlpha(accent, 0.9),
            backgroundColor: '#0F1114',
          },
          selected ? { shadowColor: accent } : null,
        ]}>
        {isDual ? (
          <View style={styles.splitBg} pointerEvents="none">
            <View style={[styles.splitHalf, { backgroundColor: withAlpha(splitA, 0.55) }]} />
            <View style={[styles.splitHalf, { backgroundColor: withAlpha(splitB, 0.55) }]} />
            <View style={styles.splitDivider} />
          </View>
        ) : null}

        <View style={[styles.circleInner, { backgroundColor: isDual ? 'rgba(0,0,0,0.35)' : withAlpha(accent, 0.14) }]}>
          <MaterialIcons name="bolt" size={12} color={isDual ? '#ECEDEE' : accent} />
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
  splitBg: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  splitHalf: {
    flex: 1,
  },
  splitDivider: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  circleInner: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

