import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TAB_BAR_CLEARANCE } from '@/components/floating-tab-bar';
import { OfflineBanner } from '@/components/offline-banner';
import { ChromePill } from '@/components/ui/chrome-pill';
import { FilterFab } from '@/components/stations/filter-fab';
import { LiveStatusPill } from '@/components/stations/live-status-pill';
import { MapLegend } from '@/components/stations/map-legend';
import { StationBottomSheet } from '@/components/stations/station-bottom-sheet';
import { markerImage } from '@/lib/markerImages';
import { StationsFilterSheet } from '@/components/stations/stations-filter-sheet';
import { useIsOffline } from '@/hooks/use-is-offline';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeColors } from '@/lib/theme/theme-context';
import { CACHE_STATUSES_TRUSTED_MS, fetchStationStatuses, listStations } from '@/lib/stations/stationsClient';
import type { Station, StationsSource } from '@/types/stations';
import { DEFAULT_STATIONS_FILTERS, type StationsFilters } from '@/types/stationsFilters';
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, Alert, AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
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
  // exact same line and clear the floating tab bar (insets.bottom guards the home indicator).
  const controlsBottom = insets.bottom + TAB_BAR_CLEARANCE;

  const [stations, setStations] = useState<Station[]>([]);
  const [filters, setFilters] = useState<StationsFilters>(DEFAULT_STATIONS_FILTERS);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [isLoadingStations, setIsLoadingStations] = useState(true);
  const [stationsApiError, setStationsApiError] = useState<string | undefined>(undefined);
  /** Where the catalog on screen came from; null until the first load settles. */
  const [loadSource, setLoadSource] = useState<StationsSource | null>(null);
  /** When the on-device cache now on screen was written (only while `loadSource === 'cache'`). */
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  /** False when that cache was old enough that the client downgraded every status to `unknown`. */
  const [cacheStatusesTrusted, setCacheStatusesTrusted] = useState(false);
  // Timestamp of the last successful contact with the backend (a catalog load or a status poll —
  // a 200 or a 304 both count). Together with the data age below it drives the freshness pill.
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  // When the backend last merged its sources — the real age of every status dot. Comes back on
  // the catalog and on every 200 poll; a 304 leaves it alone (unchanged data, growing age).
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);
  const [dataStale, setDataStale] = useState(false);

  type StationGroup = { id: string; location: Station['location']; stations: Station[] };

  function groupKeyForLocation(loc: Station['location']): string {
    // Rounding keeps grouping stable even if API has tiny float differences.
    const lat = loc.latitude.toFixed(5);
    const lng = loc.longitude.toFixed(5);
    return `${lat}:${lng}`;
  }

  // Refs mirror the bits of load state the async callbacks below need to read without being
  // re-created (and re-subscribed) on every render.
  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  const loadSourceRef = useRef<StationsSource | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emptyRetriesRef = useRef(0);
  // Mirrors `isOffline` for the poll below (kept current by the offline→online effect).
  const isOfflineRef = useRef(isOffline);
  // Identity of the cache currently on screen. A reload that serves the very same cache again
  // must not replace the stations array — that rebuilds all ~1000 markers for no visible change.
  const shownCacheRef = useRef<{ cachedAt: number | null; statusesTrusted: boolean } | null>(null);

  /**
   * Load (or reload) the catalog. Concurrency-guarded so the several triggers below — mount, the
   * Retry button, the network coming back, a foreground, the poll's recovery path — never overlap.
   * Every outcome lands in state; nothing here can leave the map on "Loading stations…" forever.
   */
  const loadStations = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setIsLoadingStations(true);
    try {
      const result = await listStations();
      if (!mountedRef.current) return;
      if (result.source === 'cache') {
        const cache = { cachedAt: result.cachedAt ?? null, statusesTrusted: result.statusesTrusted === true };
        const shown = shownCacheRef.current;
        const sameCache =
          shown != null && shown.cachedAt === cache.cachedAt && shown.statusesTrusted === cache.statusesTrusted;
        // The same cache is already on screen: only the error copy / source can have changed.
        if (!sameCache) setStations(result.stations);
        shownCacheRef.current = cache;
      } else {
        setStations(result.stations);
        shownCacheRef.current = null;
      }
      setStationsApiError(result.apiError);
      setLoadSource(result.source);
      loadSourceRef.current = result.source;
      setCachedAt(result.source === 'cache' ? (result.cachedAt ?? null) : null);
      setCacheStatusesTrusted(result.source === 'cache' && result.statusesTrusted === true);
      if (result.source === 'api') {
        setLastSyncAt(Date.now());
        if (result.lastMergeAt !== undefined) setDataAsOf(result.lastMergeAt);
        emptyRetriesRef.current = 0;
      } else if (result.errorKind === 'empty') {
        // The backend is up but has no stations (fresh deploy, a merge in progress). That fixes
        // itself within minutes, so keep asking — with backoff, since the origin is one phone.
        const attempt = emptyRetriesRef.current;
        emptyRetriesRef.current = Math.min(attempt + 1, 6);
        retryTimerRef.current = setTimeout(() => {
          // Backgrounded: let the foreground refresh pick it up instead of fetching unseen.
          if (AppState.currentState === 'active') void loadStations();
        }, Math.min(5_000 * 2 ** attempt, 120_000));
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setStationsApiError(err instanceof Error ? err.message : 'Could not load stations.');
      setLoadSource('error');
      loadSourceRef.current = 'error';
    } finally {
      loadingRef.current = false;
      if (mountedRef.current) setIsLoadingStations(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // The catalog and the location fix are independent: the map used to wait on BOTH, so a slow
    // GPS fix (or a permission prompt left unanswered) held the stations back with it. Location
    // is best-effort here — silent, no settings dialog — the FAB is the place to ask properly.
    void loadStations();
    requestAndCenterUserLocation(mapRef, { interactive: false }).catch(() => {});
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [loadStations]);

  // Recovery triggers: the network coming back, and the app returning to the foreground, both
  // re-fetch the catalog while the last load did not come from the API. (Foreground is handled in
  // the poll effect below, which owns the AppState subscription.)
  const wasOfflineRef = useRef(isOffline);
  useEffect(() => {
    const wasOffline = wasOfflineRef.current;
    wasOfflineRef.current = isOffline;
    isOfflineRef.current = isOffline;
    if (wasOffline && !isOffline && loadSourceRef.current !== 'api') void loadStations();
  }, [isOffline, loadStations]);

  // Live status refresh: poll the compact statuses feed and patch each station's overall +
  // per-connector status in place. The backend re-scrapes every ~5 min; a 60s poll keeps the
  // marker dots current. We send back the last ETag so idle polls (the ~4 of 5 between scrapes)
  // come back as a 0-byte 304 with no JSON to parse. State only changes when a status actually
  // changed, so idle polls never re-render the map. Best-effort — a failed poll leaves the
  // last-known statuses on screen. Subscribed once, for the life of the screen — gating this on
  // `stations.length` used to mean an empty first load had no path back to a full map.
  const STATUS_POLL_MS = 60_000;
  const statusEtagRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;

    async function pollStatuses() {
      // Don't poll while backgrounded — saves battery/network; we refresh on foreground instead.
      if (AppState.currentState !== 'active') return;
      // No live catalog to patch — a cache, an error, or nothing at all. The useful thing to do
      // with this tick is to try the catalog again, which is also how the pill returns to "Live".
      if (loadSourceRef.current !== 'api') {
        // Offline, a reload can only re-serve the on-device cache; the offline→online effect
        // above owns recovery, so this tick has nothing useful to do.
        if (!isOfflineRef.current) void loadStations();
        return;
      }
      const result = await fetchStationStatuses({ etag: statusEtagRef.current });
      if (cancelled || !result) return;
      // A 200 (fresh data) or a 304 (confirmed current) both count as a successful sync.
      setLastSyncAt(Date.now());
      if (result.kind === 'not-modified') return;

      setDataAsOf(result.freshness.lastMergeAt);
      setDataStale(result.freshness.stale);
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
  }, [loadStations]);

  // "Only available" only means something while the statuses on screen are real. Serving an old
  // cache, every status is `unknown` (downgraded by the client), so the filter would empty the map.
  // Derived, not reset in an effect: the switch shows off and disabled, and the filter is ignored.
  // Freshness is measured, not assumed: an API load that then loses signal keeps ageing on screen,
  // so past the same trust window the cache uses the filter switches itself off. Clock in state,
  // ticked by an interval, rather than `Date.now()` in render (react-hooks/purity).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const seed = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => {
      clearTimeout(seed);
      clearInterval(id);
    };
  }, []);
  const dataAt = dataAsOf ? Date.parse(dataAsOf) : NaN;
  // A backend that reports no merge time falls back to the last successful sync as the anchor.
  const statusesAt = Number.isFinite(dataAt) ? dataAt : lastSyncAt;
  const statusesFresh = now != null && statusesAt != null && now - statusesAt <= CACHE_STATUSES_TRUSTED_MS;
  const availabilityKnown = statusesFresh || (loadSource === 'cache' && cacheStatusesTrusted);
  const onlyAvailable = filters.onlyAvailable && availabilityKnown;

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
    if (onlyAvailable) n += 1;
    if (filters.categories.length) n += 1;
    if (filters.minPowerKw !== null && filters.minPowerKw > 0) n += 1;
    if (filters.connectorTypes.length) n += 1;
    if (filters.operators.length) n += 1;
    if (filters.cities.length) n += 1;
    if (filters.amenities.length) n += 1;
    return n;
  }, [filters, onlyAvailable]);

  const filteredStations = useMemo(() => {
    return stations.filter((s) => {
      if (onlyAvailable && s.status !== 'available') return false;

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
  }, [filters, onlyAvailable, stations]);

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
            // Consume the tap. `handled` defaults to false, which lets a marker press ALSO reach
            // the map's `onMapPress` — and that clears the selection, so tapping a charger opened
            // the sheet and closed it in the same gesture, i.e. did nothing at all.
            handled
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
        handled
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
          clusterColor={c.tint}
          clusterTextColor={c.onAccent}
          clusterSize={46}
          clusterTextSize={13}
          clusterRadius={50}
          minZoom={14}>
          {markers}
          {selectedMarker}
        </Clusterer>
      </YandexMapView>

      {/* `box-none` so the Retry link is tappable while the rest of the overlay stays transparent
          to touches — `none` would swallow the tap along with everything else. */}
      <View pointerEvents="box-none" style={[styles.topOverlay, { top: insets.top + 10 }]}>
        <OfflineBanner visible={isOffline} />
        {isLoadingStations && !stations.length ? (
          <ChromePill>
            <ActivityIndicator color={c.chromeText} />
            <ThemedText type="defaultSemiBold" style={{ color: c.chromeText }}>
              Loading stations…
            </ThemedText>
          </ChromePill>
        ) : (
          <>
            {stations.length ? (
              <LiveStatusPill
                dataAsOf={dataAsOf}
                dataStale={dataStale}
                lastSyncAt={lastSyncAt}
                cachedAt={loadSource === 'cache' ? cachedAt : null}
                isOffline={isOffline}
              />
            ) : null}
            {/* Offline with a cache is already fully explained by the two pills above, and Retry
                would fail; it re-fetches by itself when the network returns. */}
            {stationsApiError && !(isOffline && loadSource === 'cache') ? (
              <ChromePill tone="warn" style={styles.pillStack}>
                <View style={styles.pillTitleRow}>
                  <ThemedText type="defaultSemiBold" style={{ color: c.chromeText }}>
                    Stations data
                  </ThemedText>
                  <Pressable
                    onPress={() => void loadStations()}
                    disabled={isLoadingStations}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading stations">
                    <ThemedText type="defaultSemiBold" style={{ color: c.tint }}>
                      {isLoadingStations ? 'Retrying…' : 'Retry'}
                    </ThemedText>
                  </Pressable>
                </View>
                <ThemedText style={{ color: c.chromeText }}>
                  {isOffline ? "You're offline." : stationsApiError}
                </ThemedText>
              </ChromePill>
            ) : null}
          </>
        )}
      </View>

      <View style={[styles.fabColumn, { bottom: controlsBottom }]}>
        <Pressable
          onPress={() =>
            requestAndCenterUserLocation(mapRef, { interactive: true }).catch(() =>
              Alert.alert('Could not get your location', 'Try again in a moment.')
            )
          }
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
        availabilityKnown={availabilityKnown}
        onReset={() => setFilters(DEFAULT_STATIONS_FILTERS)}
        onClose={() => setIsFilterOpen(false)}
      />
    </ThemedView>
  );
}

/**
 * Centre the map on the user. `interactive` is the FAB: it may explain itself with an Alert (send
 * the user to Settings after a permanent denial, tell them GPS is off). The launch-time call is
 * silent — no dialogs before the map has even drawn — and never throws into the caller.
 */
async function requestAndCenterUserLocation(
  mapRef: React.RefObject<YandexMapViewRef | null>,
  { interactive }: { interactive: boolean }
) {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    if (interactive && !permission.canAskAgain) {
      Alert.alert('Location is off for VoltAI', 'Allow location in Settings to centre the map on you.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
      ]);
    }
    return;
  }

  if (!(await Location.hasServicesEnabledAsync())) {
    if (interactive) Alert.alert('Location is turned off', 'Turn on location (GPS) to centre the map on you.');
    return;
  }

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
    // Android can pop a "turn on location?" system dialog from inside this call; only the FAB
    // has asked for that.
    mayShowUserSettingsDialog: interactive,
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
  /** The warning variant stacks its two lines instead of sitting them side by side. */
  pillStack: { flexDirection: 'column', alignItems: 'stretch', gap: 2 },
  pillTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
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
