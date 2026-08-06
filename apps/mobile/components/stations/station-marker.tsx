import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import { Image, Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { operatorFor } from '@/lib/operators';
import type { StationStatus } from '@/types/stations';

type Props = {
  operatorId?: string;
  status: StationStatus;
  count?: number; // co-located stations sharing this pin
  selected?: boolean;
  onFirstLayout?: () => void;
};

export function statusColor(status: StationStatus): string {
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

export function StationMarker({ operatorId, status, count = 1, selected = false, onFirstLayout }: Props) {
  const op = operatorFor(operatorId);
  const ring = statusColor(status);
  const scale = selected ? 1.12 : 1;

  return (
    <View
      collapsable={false}
      style={[styles.wrap, { transform: [{ scale }] }]}
      onLayout={(e: LayoutChangeEvent) => {
        if (e.nativeEvent.layout.height > 0) onFirstLayout?.();
      }}>
      <View style={[styles.pin, { borderColor: ring }, selected ? styles.pinSelected : null]}>
        {op.logo ? (
          <Image source={op.logo} style={styles.logo} resizeMode="contain" />
        ) : (
          <View style={[styles.fallback, { backgroundColor: op.color }]}>
            <MaterialIcons name="bolt" size={16} color="#fff" />
          </View>
        )}
      </View>

      {/* status pip */}
      <View style={[styles.statusPip, { backgroundColor: ring }]} />

      {count > 1 ? (
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{count > 9 ? '9+' : count}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pin: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 2.5,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.28,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
  pinSelected: {
    borderWidth: 3,
  },
  logo: {
    width: 30,
    height: 30,
    borderRadius: 9,
  },
  fallback: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPip: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 11,
    height: 11,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#0F1114',
  },
  countBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 999,
    backgroundColor: '#0F1114',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
});
