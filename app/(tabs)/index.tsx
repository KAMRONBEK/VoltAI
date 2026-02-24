import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { OfflineBanner } from '@/components/offline-banner';
import { FilterFab } from '@/components/stations/filter-fab';
import { StationBottomSheet } from '@/components/stations/station-bottom-sheet';
import { StationMarker } from '@/components/stations/station-marker';
import { StationsFilterSheet } from '@/components/stations/stations-filter-sheet';
import { useIsOffline } from '@/hooks/use-is-offline';
import { listStations } from '@/lib/stations/stationsClient';
import type { Station } from '@/types/stations';
import { DEFAULT_STATIONS_FILTERS, type StationsFilters } from '@/types/stationsFilters';
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';

const UZBEKISTAN_REGION: Region = {
  latitude: 41.2995,
  longitude: 69.2401,
  latitudeDelta: 4.0,
  longitudeDelta: 4.0,
};

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1d1d1d' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1d1d1d' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#6b6b6b' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b0b0b' }] },
];

export default function StationsMapScreen() {
  const mapRef = useRef<MapView | null>(null);
  const isOffline = useIsOffline();

  const MARKER_SNAPSHOT_KEY_VERSION = 1;

  const [stations, setStations] = useState<Station[]>([]);
  const [filters, setFilters] = useState<StationsFilters>(DEFAULT_STATIONS_FILTERS);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [isLoadingStations, setIsLoadingStations] = useState(true);
  const [stationsApiError, setStationsApiError] = useState<string | undefined>(undefined);
  const [markerReady, setMarkerReady] = useState<Record<string, string>>({});

  const selectedStation = useMemo(
    () => stations.find((s) => s.id === selectedStationId) ?? null,
    [stations, selectedStationId]
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [stationsResult] = await Promise.all([listStations(), requestAndCenterUserLocation(mapRef)]);
        if (cancelled) return;
        setStations(stationsResult.stations);
        setStationsApiError(stationsResult.apiError);
      } finally {
        if (!cancelled) setIsLoadingStations(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

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

  useEffect(() => {
    // If the rendered set of markers changes, force Android to re-snapshot marker views.
    if (Platform.OS !== 'android') return;
    setMarkerReady({});
  }, [filteredStations.length]);

  const markers = useMemo(
    () =>
      filteredStations.map((station) => {
        const isSelected = station.id === selectedStationId;
        const expectedKey = `${MARKER_SNAPSHOT_KEY_VERSION}:${isSelected ? 'sel' : 'norm'}`;
        const currentKey = markerReady[station.id];

        const androidNeedsSnapshot = Platform.OS === 'android' && currentKey !== expectedKey;
        const tracksViewChanges = Platform.OS === 'android' ? androidNeedsSnapshot : isSelected;

        return (
          <Marker
            key={station.id}
            coordinate={station.location}
            onPress={() => setSelectedStationId(station.id)}
            accessibilityLabel={station.name}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={tracksViewChanges}>
            <StationMarker
              status={station.status}
              selected={isSelected}
              onFirstLayout={() => {
                if (Platform.OS !== 'android') return;
                setMarkerReady((prev) => {
                  if (prev[station.id] === expectedKey) return prev;
                  return { ...prev, [station.id]: expectedKey };
                });
              }}
            />
          </Marker>
        );
      }),
    [filteredStations, markerReady, selectedStationId]
  );

  return (
    <ThemedView style={styles.container}>
      <MapView
        ref={(r) => {
          mapRef.current = r;
        }}
        // Android uses Google Maps by default; iOS requires a native build for Google Maps.
        // Expo Go on iOS typically supports Apple Maps, so we avoid forcing Google there.
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={UZBEKISTAN_REGION}
        style={StyleSheet.absoluteFill}
        customMapStyle={DARK_MAP_STYLE}
        showsUserLocation
        showsMyLocationButton={Platform.OS === 'android'}
        onPress={() => setSelectedStationId(null)}>
        {markers}
      </MapView>

      <View pointerEvents="none" style={styles.topOverlay}>
        <OfflineBanner visible={isOffline} />
        {isLoadingStations ? (
          <View style={styles.pill}>
            <ActivityIndicator />
            <ThemedText type="defaultSemiBold">Loading stations…</ThemedText>
          </View>
        ) : stationsApiError ? (
          <View style={styles.pillWarning}>
            <ThemedText type="defaultSemiBold">Stations data</ThemedText>
            <ThemedText>{stationsApiError}</ThemedText>
          </View>
        ) : null}
      </View>

      <View style={styles.filterFabWrap}>
        <FilterFab badgeCount={activeFilterCount} onPress={() => setIsFilterOpen(true)} />
      </View>

      <StationBottomSheet
        station={selectedStation}
        onClose={() => setSelectedStationId(null)}
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

async function requestAndCenterUserLocation(mapRef: React.RefObject<MapView | null>) {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) return;

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  const region: Region = {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  };

  mapRef.current?.animateToRegion(region, 450);
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
    backgroundColor: 'rgba(18, 18, 18, 0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  pillWarning: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(18, 18, 18, 0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 184, 0, 0.35)',
  },
  filterFabWrap: {
    position: 'absolute',
    right: 12,
    bottom: 110,
  },
});
