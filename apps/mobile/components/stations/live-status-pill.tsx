import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';

/**
 * Compact "Live" indicator for the map. Shows that the app is actively in sync with the backend
 * (which re-scrapes charger statuses every ~5 min and which we poll every 60s). A pulsing green
 * dot means we synced recently; it goes amber/grey and stops pulsing if polls start failing or
 * the device is offline. `lastSyncAt` is the last successful poll (a 200 *or* a 304 — both mean
 * "confirmed current").
 */

// While synced within this window we consider the feed "Live"; beyond it we're likely reconnecting.
const LIVE_WINDOW_SEC = 180;

function relative(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 15) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

type Props = {
  lastSyncAt: number | null;
  isOffline?: boolean;
};

export function LiveStatusPill({ lastSyncAt, isOffline }: Props) {
  // Re-render on a ticker so the relative label ("1m ago") stays current between polls.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 15_000);
    return () => clearInterval(id);
  }, []);

  const ageSec = lastSyncAt != null ? Math.floor((Date.now() - lastSyncAt) / 1000) : null;
  const live = !isOffline && ageSec != null && ageSec < LIVE_WINDOW_SEC;

  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!live) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [live, pulse]);

  const color = live ? '#2FE28A' : isOffline ? '#8A9099' : '#F7B84B';
  const label = useMemo(() => {
    if (isOffline) return 'Offline';
    if (lastSyncAt == null) return 'Connecting…';
    if (!live) return 'Reconnecting…';
    return ageSec != null && ageSec >= 15 ? `Live · ${relative(lastSyncAt)}` : 'Live';
  }, [isOffline, lastSyncAt, live, ageSec]);

  return (
    <View style={styles.pill}>
      <Animated.View style={[styles.dot, { backgroundColor: color, opacity: pulse }]} />
      <ThemedText style={styles.text}>{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(18, 18, 18, 0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
