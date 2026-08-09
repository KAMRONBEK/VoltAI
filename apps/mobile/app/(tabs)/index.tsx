import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { OfflineBanner } from '@/components/offline-banner';
import { FilterFab } from '@/components/stations/filter-fab';
import { LiveStatusPill } from '@/components/stations/live-status-pill';
import { MapLegend } from '@/components/stations/map-legend';
import { StationBottomSheet } from '@/components/stations/station-bottom-sheet';
import { markerImage } from '@/lib/markerImages';
import { StationsFilterSheet } from '@/components/stations/stations-filter-sheet';
import { useIsOffline } from '@/hooks/use-is-offline';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeColors } from '@/lib/theme/theme-context';
import { fetchStationStatuses, listStations } from '@/lib/stations/stationsClient';
import type { Station } from '@/types/stations';
import { DEFAULT_STATIONS_FILTERS, type StationsFilters } from '@/types/stationsFilters';
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, AppState, Pressable, StyleSheet, View } from 'react-native';
import { Clusterer, Marker, YandexMapView, type YandexMapViewRef } from 'expo-yandex-mapkit';

const UZBEKISTAN_CAMERA = {
  latitude: 41.2995,
  longitude: 69.2401,
  zoom: 6.5, // ≈ the former region deltas of 4.0 — whole-country view
};

// Yandex MapKit uses its built-in `nightMode` dark scheme. The old Google `customMapStyle`
// array is not portable to Yandex's tags/elements style schema; if a bespoke palette is
// needed later, author a Yandex `mapStyle` JSON string and pass it as the `mapStyle` prop.

export default function StationsMapScreen() {
  const mapRef = useRef<YandexMapViewRef | null>(null);
  const insets = useSafeAreaInsets();
  const isOffline = useIsOffline();
  const colorScheme = useColorScheme();
  const c = useThemeColors();
  // Single shared baseline so the right-side FAB column and the left-side legend sit on the
  // exact same line and clear the tab bar (insets.bottom guards the home indicator).
  // Clear the floating tab bar (bottom: insets.bottom + 12, height 64) so the map controls
  // and legend sit above it rather than behind it.
  const controlsBottom = insets.bottom + 92;

  const [stations, setStations] = useState<Station[]>([]);
  const [filters, setFilters] = useState<StationsFilters>(DEFAULT_STATIONS_FILTERS);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [isLoadingStations, setIsLoadingStations] = useState(true);
  const [stationsApiError, setStationsApiError] = useState<string | undefined>(undefined);
  // Timestamp of the last successful sync with the backend (initial load or a status poll) —
  // drives the "Live" freshness pill.
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  type StationGroup = { id: string; location: Station['location']; stations: Station[] };

  function groupKeyForLocation(loc: Station['location']): string {
    // Rounding keeps grouping stable even if API has tiny float differences.
    const lat = loc.latitude.toFixed(5);
    const lng = loc.longitude.toFixed(5);
    return `${lat}:${lng}`;
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [stationsResult] = await Promise.all([listStations(), requestAndCenterUserLocation(mapRef)]);
        if (cancelled) return;
        setStations(stationsResult.stations);
        setStationsApiError(stationsResult.apiError);
        if (stationsResult.source === 'api') setLastSyncAt(Date.now());
      } finally {
        if (!cancelled) setIsLoadingStations(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live status refresh: poll the compact statuses feed and patch each station's overall +
  // per-connector status in place. The backend re-scrapes every ~5 min; a 60s poll keeps the
  // marker dots current. We send back the last ETag so idle polls (the ~4 of 5 between scrapes)
  // come back as a 0-byte 304 with no JSON to parse. State only changes when a status actually
  // changed, so idle polls never re-render the map. Best-effort — a failed poll leaves the
  // last-known statuses on screen.
  const STATUS_POLL_MS = 60_000;
  const statusEtagRef = useRef<string | null>(null);
  useEffect(() => {
    if (!stations.length) return;
    let cancelled = false;

    async function pollStatuses() {
      // Don't poll while backgrounded — saves battery/network; we refresh on foreground instead.
      if (AppState.currentState !== 'active') return;
      const result = await fetchStationStatuses({ etag: statusEtagRef.current });
      if (cancelled || !result) return;
      // A 200 (fresh data) or a 304 (confirmed current) both count as a successful sync.
      setLastSyncAt(Date.now());
      if (result.kind === 'not-modified') return;

      // Keep the last good ETag if a proxy stripped it from this response, so we don't silently
      // lose the 304 optimization on every subsequent poll.
      if (result.etag) statusEtagRef.current = result.etag;
      const updates = result.updates;
      if (!updates.length) return;
      const byId = new Map(updates.map((u) => [u.id, u]));

      setStations((prev) => {
        let changed = false;
        const next = prev.map((s) => {
          const u = byId.get(s.id);
          if (!u) return s;
          // Only patch per-connector status when the feed and catalog agree on connector
          // count — the catalog can drop a connector the feed keeps, and index-matching a
          // shorter array would apply statuses to the wrong connectors. On a mismatch, fall
          // back to updating just the station's overall status.
          let connectorsChanged = false;
          const connectors =
            u.connectors.length === s.connectors.length
              ? s.connectors.map((c, i) => {
                  const nextStatus = u.connectors[i];
                  if (nextStatus && nextStatus !== c.status) {
                    connectorsChanged = true;
                    return { ...c, status: nextStatus };
                  }
                  return c;
                })
              : s.connectors;
          if (!connectorsChanged && u.status === s.status) return s;
          changed = true;
          return { ...s, status: u.status, connectors };
        });
        return changed ? next : prev;
      });
    }

    const timer = setInterval(pollStatuses, STATUS_POLL_MS);
    // Refresh immediately when the app returns to the foreground, rather than waiting up to 60s.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pollStatuses();
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      appStateSub.remove();
    };
  }, [stations.length]);

  const filterOptions = useMemo(() => {
    const connectorTypes = new Set<string>();
    const operators = new Set<string>();
    const cities = new Set<string>();
    const amenities = new Set<string>();

    for (const s of stations) {
      for (const c of s.connectors) connectorTypes.add(c.type);
      if (s.operator) operators.add(s.operator);
      if (s.city) cities.add(s.city);
      for (const a of s.amenities ?? []) amenities.add(a);
    }

    return {
      connectorTypes: Array.from(connectorTypes).sort(),
      operators: Array.from(operators).sort(),
      cities: Array.from(cities).sort(),
      amenities: Array.from(amenities).sort(),
    };
  }, [stations]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.onlyAvailable) n += 1;
    if (filters.categories.length) n += 1;
    if (filters.minPowerKw !== null && filters.minPowerKw > 0) n += 1;
    if (filters.connectorTypes.length) n += 1;
    if (filters.operators.length) n += 1;
    if (filters.cities.length) n += 1;
    if (filters.amenities.length) n += 1;
    return n;
  }, [filters]);

  const filteredStations = useMemo(() => {
    return stations.filter((s) => {
      if (filters.onlyAvailable && s.status !== 'available') return false;

      if (filters.categories.length) {
        if (!s.category || !filters.categories.includes(s.category)) return false;
      }

      if (filters.connectorTypes.length) {
        const match = s.connectors.some((c) => filters.connectorTypes.includes(c.type));
        if (!match) return false;
      }

      if (filters.minPowerKw !== null && filters.minPowerKw > 0) {
        const maxKw = s.connectors.reduce((m, c) => Math.max(m, c.powerKw || 0), 0);
        if (maxKw < filters.minPowerKw) return false;
      }

      if (filters.operators.length) {
        if (!s.operator || !filters.operators.includes(s.operator)) return false;
      }

      if (filters.cities.length) {
        if (!s.city || !filters.cities.includes(s.city)) return false;
      }

      if (filters.amenities.length) {
        const stationAmenities = s.amenities ?? [];
        const match = filters.amenities.some((a) => stationAmenities.includes(a));
        if (!match) return false;
      }

      return true;
    });
  }, [filters, stations]);

  const stationGroups = useMemo<StationGroup[]>(() => {
    const map = new Map<string, StationGroup>();
    for (const s of filteredStations) {
      const id = groupKeyForLocation(s.location);
      const existing = map.get(id);
      if (existing) {
        existing.stations.push(s);
      } else {
        map.set(id, { id, location: s.location, stations: [s] });
      }
    }

    // Sort each co-located group so the best-available station leads (drives the pin's
    // operator logo + status). The native Clusterer handles map-wide density.
    for (const g of map.values()) {
      g.stations.sort((a, b) => {
        const rank = (st: Station) =>
          st.status === 'available' ? 0 : st.status === 'in_use' ? 1 : st.status === 'unknown' ? 2 : 3;
        return rank(a) - rank(b);
      });
    }

    return Array.from(map.values());
  }, [filteredStations]);

  const selectedStations = useMemo(() => {
    if (!selectedGroupId) return null;
    return stationGroups.find((g) => g.id === selectedGroupId)?.stations ?? null;
  }, [selectedGroupId, stationGroups]);

  // Markers depend ONLY on stationGroups — NOT on selectedGroupId. Selecting a pin used to be in
  // this memo's deps, so every tap regenerated all ~1000 marker elements and stalled the JS thread
  // (which is what made the bottom sheet open late/never). Selection highlight is drawn as a single
  // separate overlay marker below, so a tap only adds/moves one element instead of rebuilding all.
  const markers = useMemo(
    () =>
      stationGroups.map((group) => {
        const primary = group.stations[0];
        // One status per connector/charger across all stations at this exact spot → the
        // marker image shows a colored dot per charger + the operator logo.
        const statuses = group.stations.flatMap((s) => s.connectors.map((c) => c.status));
        return (
          <Marker
            key={group.id}
            point={group.location}
            identifier={group.id}
            onPress={(e) => setSelectedGroupId(e.nativeEvent.identifier ?? group.id)}
            // Image is 148x176 with the logo centred at y≈58 → anchor on the logo.
            anchor={{ x: 0.5, y: 0.33 }}
            scale={0.72}
            zIndex={1}
            source={markerImage(
              primary?.operatorId,
              primary?.category,
              statuses.length ? statuses : [primary?.status ?? 'unknown']
            )}
          />
        );
      }),
    [stationGroups]
  );

  // The selected pin, enlarged, drawn on top — recomputing just this one element on selection keeps
  // the highlight without touching the memoized `markers` array (so taps stay snappy).
  const selectedMarker = useMemo(() => {
    if (!selectedGroupId) return null;
    const group = stationGroups.find((g) => g.id === selectedGroupId);
    if (!group) return null;
    const primary = group.stations[0];
    const statuses = group.stations.flatMap((s) => s.connectors.map((c) => c.status));
    return (
      <Marker
        key={`selected-${group.id}`}
        point={group.location}
        identifier={group.id}
        onPress={(e) => setSelectedGroupId(e.nativeEvent.identifier ?? group.id)}
        anchor={{ x: 0.5, y: 0.33 }}
        scale={0.92}
        zIndex={10}
        source={markerImage(
          primary?.operatorId,
          primary?.category,
          statuses.length ? statuses : [primary?.status ?? 'unknown']
        )}
      />
    );
  }, [selectedGroupId, stationGroups]);

  return (
    <ThemedView style={styles.container}>
      <YandexMapView
        ref={mapRef}
        cameraPosition={UZBEKISTAN_CAMERA}
        animated={false}
        style={StyleSheet.absoluteFill}
        nightMode={colorScheme === 'dark'}
        showUserPosition
        // Keep the camera centre above the bottom sheet so a selected pin isn't hidden.
        mapPadding={{ bottom: insets.bottom + 120 }}
        onMapPress={() => setSelectedGroupId(null)}>
        <Clusterer
          clusterColor="#22E06B"
          clusterTextColor="#07120B"
          clusterSize={46}
          clusterTextSize={13}
          clusterRadius={50}
          minZoom={14}>
          {markers}
          {selectedMarker}
        </Clusterer>
      </YandexMapView>

      <View pointerEvents="none" style={[styles.topOverlay, { top: insets.top + 10 }]}>
        <OfflineBanner visible={isOffline} />
        {isLoadingStations ? (
          <View style={[styles.pill, { backgroundColor: c.chrome, borderColor: c.chromeBorder }]}>
            <ActivityIndicator color={c.chromeText} />
            <ThemedText type="defaultSemiBold" style={{ color: c.chromeText }}>
              Loading stations…
            </ThemedText>
          </View>
        ) : stationsApiError ? (
          <View style={[styles.pillWarning, { backgroundColor: c.chrome }]}>
            <ThemedText type="defaultSemiBold" style={{ color: c.chromeText }}>
              Stations data
            </ThemedText>
            <ThemedText style={{ color: c.chromeText }}>{stationsApiError}</ThemedText>
          </View>
        ) : (
          <LiveStatusPill lastSyncAt={lastSyncAt} isOffline={isOffline} />
        )}
      </View>

      <View style={[styles.fabColumn, { bottom: controlsBottom }]}>
        <Pressable
          onPress={() => requestAndCenterUserLocation(mapRef)}
          style={[styles.fabButton, { backgroundColor: c.chrome, borderColor: c.chromeBorder, boxShadow: c.chromeShadow }]}
          accessibilityRole="button"
          accessibilityLabel="My location">
          <MaterialIcons name="my-location" size={20} color={c.chromeIcon} />
        </Pressable>

        <FilterFab badgeCount={activeFilterCount} onPress={() => setIsFilterOpen(true)} />
      </View>

      {!selectedStations ? (
        <View style={[styles.legendWrap, { bottom: controlsBottom }]} pointerEvents="box-none">
          <MapLegend />
        </View>
      ) : null}

      <StationBottomSheet
        stations={selectedStations}
        onClose={() => setSelectedGroupId(null)}
      />

      <StationsFilterSheet
        open={isFilterOpen}
        filters={filters}
        options={filterOptions}
        onChange={setFilters}
        onReset={() => setFilters(DEFAULT_STATIONS_FILTERS)}
        onClose={() => setIsFilterOpen(false)}
      />
    </ThemedView>
  );
}

async function requestAndCenterUserLocation(mapRef: React.RefObject<YandexMapViewRef | null>) {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) return;

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  await mapRef.current?.setCenter(
    {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      zoom: 12.5, // ≈ the former 0.08 region delta
    },
    { durationSeconds: 0.45 }
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillWarning: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 184, 0, 0.35)',
  },
  fabColumn: {
    position: 'absolute',
    // Pull the column edge in by the badge overhang so the buttons keep a 12px margin while the
    // FilterFab's top:-6/right:-6 count badge gets room to render fully (not clipped).
    right: 6,
    gap: 10,
    alignItems: 'flex-end',
    paddingRight: 6,
    paddingTop: 6,
  },
  legendWrap: {
    position: 'absolute',
    left: 12,
    maxWidth: 260,
  },
  fabButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
