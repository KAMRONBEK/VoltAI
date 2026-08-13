import React, { useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChromePill } from '@/components/ui/chrome-pill';
import { statusColor } from '@/constants/theme';
import { useThemeColors } from '@/lib/theme/theme-context';

/**
 * Compact "Live" indicator for the map. Shows that the app is actively in sync with the backend
 * (which re-scrapes charger statuses every ~5 min and which we poll every 60s). A pulsing green
 * dot means we synced recently; it goes amber/grey and stops pulsing if polls start failing or
 * the device is offline. `lastSyncAt` is the last successful poll (a 200 *or* a 304 — both mean
 * "confirmed current").
 */

// While synced within this window we consider the feed "Live"; beyond it we're likely reconnecting.
const LIVE_WINDOW_SEC = 180;

function relative(ageSec: number): string {
  const s = Math.max(0, ageSec);
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
  const c = useThemeColors();
  // Re-render on a ticker so the relative label ("1m ago") stays current between polls.
  // The clock is state, ticked by the interval, rather than `Date.now()` read during render:
  // reading it in the render body makes the component's output depend on when React happens to
  // re-render it, which is exactly what `react-hooks/purity` objects to. Seeded from the effect
  // so the very first frame is a pure function of props.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    // Seeded from a timer rather than straight from the effect body: setting state synchronously
    // while the effect runs costs an extra render pass, which the lint rule correctly objects to.
    const seed = setTimeout(tick, 0);
    const id = setInterval(tick, 15_000);
    return () => {
      clearTimeout(seed);
      clearInterval(id);
    };
  }, []);

  const ageSec = lastSyncAt != null && now != null ? Math.floor((now - lastSyncAt) / 1000) : null;
  const live = !isOffline && ageSec != null && ageSec < LIVE_WINDOW_SEC;

  // `useMemo`, not `useRef(new Animated.Value(1)).current`: reading `.current` during render is
  // what the react-hooks/refs rule objects to, and the ref form also constructs a throwaway
  // Animated.Value on every single render just to discard it.
  const pulse = useMemo(() => new Animated.Value(1), []);
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

  // Before the clock is seeded the freshness is genuinely unknown, which is grey — not the
  // amber that means "we have lost touch".
  const color = statusColor(
    live ? 'available' : isOffline ? 'offline' : now == null ? 'unknown' : 'in_use',
    c
  );
  const label = useMemo(() => {
    if (isOffline) return 'Offline';
    if (lastSyncAt == null || now == null) return 'Connecting…';
    if (!live) return 'Reconnecting…';
    return ageSec != null && ageSec >= 15 ? `Live · ${relative(ageSec)}` : 'Live';
  }, [isOffline, lastSyncAt, live, ageSec, now]);

  return (
    <ChromePill>
      <Animated.View style={[styles.dot, { backgroundColor: color, opacity: pulse }]} />
      <ThemedText style={[styles.text, { color: c.chromeText }]}>{label}</ThemedText>
    </ChromePill>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  text: {
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
