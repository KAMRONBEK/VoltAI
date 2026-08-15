import React, { useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChromePill } from '@/components/ui/chrome-pill';
import { statusColor } from '@/constants/theme';
import { CACHE_STATUSES_TRUSTED_MS } from '@/lib/stations/stationsClient';
import { useThemeColors } from '@/lib/theme/theme-context';

/**
 * Compact freshness indicator for the map, driven by the age of the DATA, not by connectivity.
 *
 * "Live" used to mean "a poll succeeded recently" — which stayed green while the backend's own
 * scrape loop was stuck and every dot on the map was an hour old. The backend reports when it last
 * merged its sources (`lastMergeAt`) and its own `stale` verdict; this pill measures from that.
 * A pulsing green dot: statuses are under `LIVE_WINDOW_MS` old and the backend agrees they are
 * fresh. Amber: they are older or the backend says stale. Grey: offline, serving the on-device
 * cache, or nothing has arrived yet.
 */

/** Statuses younger than this, and not flagged stale by the backend, count as live. */
const LIVE_WINDOW_MS = 15 * 60_000;

function relative(ageMs: number): string {
  const s = Math.max(0, Math.floor(ageMs / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

function ageLabel(ageMs: number): string {
  const m = Math.floor(ageMs / 60_000);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

type Props = {
  /** ISO time the backend last merged its sources — the true age of every status shown. */
  dataAsOf: string | null;
  /** The backend's own verdict from the last 200 poll (its scrape loop has fallen behind). */
  dataStale?: boolean;
  /** Last successful contact with the backend (a 200 *or* a 304). Null until the first sync. */
  lastSyncAt: number | null;
  /** When the catalog on screen came from the on-device cache: when that cache was written. */
  cachedAt?: number | null;
  isOffline?: boolean;
};

export function LiveStatusPill({ dataAsOf, dataStale, lastSyncAt, cachedAt, isOffline }: Props) {
  const c = useThemeColors();
  // Re-render on a ticker so the relative label ("3 min old") stays current between polls.
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

  const dataAt = dataAsOf ? Date.parse(dataAsOf) : NaN;
  const dataAgeMs = now != null && Number.isFinite(dataAt) ? Math.max(0, now - dataAt) : null;
  const cacheAgeMs = now != null && cachedAt != null ? Math.max(0, now - cachedAt) : null;
  // The cache only speaks for itself until the backend has been reached once this session.
  const servingCache = cacheAgeMs != null && lastSyncAt == null;
  const live =
    !isOffline && !servingCache && lastSyncAt != null && dataAgeMs != null && dataAgeMs < LIVE_WINDOW_MS && !dataStale;

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

  const { label, tone } = useMemo((): { label: string; tone: 'available' | 'in_use' | 'offline' | 'unknown' } => {
    if (isOffline) {
      // With a live catalog on screen the dots keep ageing while there is no signal — say how old.
      const label =
        cacheAgeMs != null
          ? `Offline · saved ${relative(cacheAgeMs)}`
          : dataAgeMs != null
            ? `Offline · statuses ${ageLabel(dataAgeMs)} old`
            : 'Offline';
      return { label, tone: 'offline' };
    }
    if (servingCache && cacheAgeMs != null) {
      // Past the trust window the client has already downgraded every status to unknown; say so.
      const statusesUnknown = cacheAgeMs > CACHE_STATUSES_TRUSTED_MS;
      return {
        label: statusesUnknown ? `Cached ${relative(cacheAgeMs)} — statuses unknown` : `Cached ${relative(cacheAgeMs)}`,
        tone: 'unknown',
      };
    }
    // Before the clock is seeded the freshness is genuinely unknown, which is grey — not the
    // amber that means "we have lost touch".
    if (lastSyncAt == null || now == null) return { label: 'Connecting…', tone: 'unknown' };
    if (live) return { label: 'Live', tone: 'available' };
    if (dataAgeMs == null) return { label: 'Connected — no status data yet', tone: 'unknown' };
    return { label: `Statuses ${ageLabel(dataAgeMs)} old`, tone: 'in_use' };
  }, [isOffline, servingCache, cacheAgeMs, lastSyncAt, now, live, dataAgeMs]);

  return (
    <ChromePill>
      <Animated.View style={[styles.dot, { backgroundColor: statusColor(tone, c), opacity: pulse }]} />
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
