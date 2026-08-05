import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { getApps } from 'react-native-map-link';

import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Station } from '@/types/stations';

type Props = {
  stations: Station[] | null;
  onClose: () => void;
};

function formatStatus(status: Station['status']): string {
  switch (status) {
    case 'available':
      return 'Available';
    case 'in_use':
      return 'In use';
    case 'offline':
      return 'Offline';
    default:
      return 'Unknown';
  }
}

function statusDotColor(status: Station['status']): string {
  switch (status) {
    case 'available':
      return '#2FE28A';
    case 'in_use':
      return '#F7B84B';
    case 'offline':
      return '#6D6D6D';
    default:
      return '#9BA1A6';
  }
}

type NavApp = {
  id: string;
  name: string;
  icon: unknown;
  open: () => Promise<string | void>;
};

const APPS_WHITELIST = ['google-maps', 'apple-maps', 'yandex', 'yandex-maps', 'dgis', 'maps-me', 'waze'];

export function StationBottomSheet({ stations, onClose }: Props) {
  const colorScheme = useColorScheme() ?? 'dark';
  const sheetRef = useRef<BottomSheet | null>(null);

  const snapPoints = useMemo(() => [180, 340, '85%'], []);

  const stationsIdsKey = useMemo(() => (stations ? stations.map((s) => s.id).join('|') : ''), [stations]);
  const stationsList = useMemo(() => stations ?? [], [stations]);
  const firstStationIdFromKey = useMemo(() => {
    const first = stationsIdsKey.split('|')[0];
    return first && first.length ? first : null;
  }, [stationsIdsKey]);

  const [showNavApps, setShowNavApps] = useState(false);
  const [navApps, setNavApps] = useState<NavApp[]>([]);
  const [navLoading, setNavLoading] = useState(false);
  const [navError, setNavError] = useState<string | null>(null);
  const [activeStationId, setActiveStationId] = useState<string | null>(null);
  const [prevStationsKey, setPrevStationsKey] = useState(stationsIdsKey);

  useEffect(() => {
    if (!sheetRef.current) return;

    if (stationsList.length) {
      sheetRef.current.snapToIndex(1);
    } else {
      sheetRef.current.close();
    }
  }, [stationsList.length]);

  // Reset the navigation section whenever the selected station(s) change. This uses
  // React's "adjust state during render" pattern instead of an effect, which avoids the
  // cascading render flagged by react-hooks/set-state-in-effect and is compatible with
  // the React Compiler.
  if (prevStationsKey !== stationsIdsKey) {
    setPrevStationsKey(stationsIdsKey);
    setShowNavApps(false);
    setNavApps([]);
    setNavLoading(false);
    setNavError(null);
    setActiveStationId(firstStationIdFromKey);
  }

  const activeStation = useMemo(() => {
    if (!stationsList.length) return null;
    if (!activeStationId) return stationsList[0] ?? null;
    return stationsList.find((s) => s.id === activeStationId) ?? stationsList[0] ?? null;
  }, [activeStationId, stationsList]);

  const backgroundColor = Colors[colorScheme].background;
  const textColor = Colors[colorScheme].text;

  async function ensureNavAppsLoaded(s: Station) {
    if (navLoading) return;
    if (navApps.length) return;

    setNavError(null);
    setNavLoading(true);
    try {
      const list = (await getApps({
        latitude: s.location.latitude,
        longitude: s.location.longitude,
        title: s.name,
        address: s.address,
        alwaysIncludeGoogle: true,
        appsWhiteList: APPS_WHITELIST,
      })) as NavApp[];
      setNavApps(list);
    } catch (e) {
      setNavError(e instanceof Error ? e.message : 'Failed to load navigation apps.');
    } finally {
      setNavLoading(false);
    }
  }

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={onClose}
      backgroundStyle={[styles.sheetBackground, { backgroundColor }]}
      handleIndicatorStyle={{ backgroundColor: 'rgba(255,255,255,0.25)' }}>
      <BottomSheetView style={styles.content}>
        {activeStation ? (
          <>
            <View style={styles.headerRow}>
              <View style={styles.titleWrap}>
                <ThemedText type="subtitle" numberOfLines={1}>
                  {activeStation.name}
                </ThemedText>
                <View style={styles.metaRow}>
                  <View
                    style={[styles.statusDot, { backgroundColor: statusDotColor(activeStation.status) }]}
                  />
                  <ThemedText style={{ color: textColor }}>{formatStatus(activeStation.status)}</ThemedText>
                </View>
              </View>

              <Pressable style={styles.closeButton} onPress={onClose} accessibilityRole="button">
                <ThemedText type="defaultSemiBold">Close</ThemedText>
              </Pressable>
            </View>

            {stations && stations.length > 1 ? (
              <View style={styles.switchRow}>
                {stations.slice(0, 2).map((s) => {
                  const isOn = s.id === activeStation.id;
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => setActiveStationId(s.id)}
                      style={[
                        styles.switchChip,
                        isOn ? { borderColor: `${Colors[colorScheme].tint}99` } : null,
                        isOn ? { backgroundColor: `${Colors[colorScheme].tint}1A` } : null,
                      ]}
                      accessibilityRole="button">
                      <View style={[styles.smallDot, { backgroundColor: statusDotColor(s.status) }]} />
                      <ThemedText type="defaultSemiBold" numberOfLines={1}>
                        {s.name}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {activeStation.address || activeStation.city ? (
              <ThemedText style={styles.addressText} numberOfLines={2}>
                {[activeStation.address, activeStation.city].filter(Boolean).join(' · ')}
              </ThemedText>
            ) : null}

            {activeStation.operator ? (
              <ThemedText style={styles.operatorText} numberOfLines={1}>
                Operator: {activeStation.operator}
              </ThemedText>
            ) : null}

            <View style={styles.section}>
              <ThemedText type="defaultSemiBold">Connectors</ThemedText>
              <View style={styles.pillsRow}>
                {activeStation.connectors.length ? (
                  activeStation.connectors.map((c) => (
                    <View key={c.id} style={styles.pill}>
                      <ThemedText type="defaultSemiBold">
                        {c.type} {c.powerKw ? `${Math.round(c.powerKw)}kW` : ''}
                      </ThemedText>
                    </View>
                  ))
                ) : (
                  <ThemedText>Unknown</ThemedText>
                )}
              </View>
            </View>

            <View style={styles.actionsRow}>
              <Pressable
                style={[styles.actionPrimary, { backgroundColor: Colors[colorScheme].tint }]}
                onPress={async () => {
                  const next = !showNavApps;
                  setShowNavApps(next);
                  if (next) {
                    await ensureNavAppsLoaded(activeStation);
                    sheetRef.current?.snapToIndex(2);
                  }
                }}
                accessibilityRole="button">
                <ThemedText style={styles.actionPrimaryText}>
                  {showNavApps ? 'Hide navigation apps' : 'Navigate'}
                </ThemedText>
              </Pressable>
            </View>

            {showNavApps ? (
              <View style={styles.navSection}>
                <ThemedText type="defaultSemiBold">Navigation apps</ThemedText>
                {navLoading ? (
                  <View style={styles.navState}>
                    <ActivityIndicator />
                    <ThemedText type="defaultSemiBold">Loading…</ThemedText>
                  </View>
                ) : navError ? (
                  <View style={styles.navState}>
                    <ThemedText type="defaultSemiBold">Couldn’t load apps</ThemedText>
                    <ThemedText>{navError}</ThemedText>
                  </View>
                ) : navApps.length === 0 ? (
                  <View style={styles.navState}>
                    <ThemedText type="defaultSemiBold">No apps found</ThemedText>
                    <ThemedText>Install a navigation app to start directions.</ThemedText>
                  </View>
                ) : (
                  <View style={styles.navList}>
                    {navApps.map((app) => (
                      <Pressable
                        key={app.id}
                        style={styles.navRow}
                        onPress={async () => {
                          try {
                            await app.open();
                          } catch (e) {
                            setNavError(e instanceof Error ? e.message : 'Failed to open app.');
                          }
                        }}
                        accessibilityRole="button">
                        <View style={styles.navRowLeft}>
                          <Image source={app.icon as never} style={styles.navIcon} />
                          <ThemedText type="defaultSemiBold">{app.name}</ThemedText>
                        </View>
                        <ThemedText>Open</ThemedText>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.emptyState}>
            <ThemedText type="defaultSemiBold">Tap a marker</ThemedText>
            <ThemedText>Station details appear here.</ThemedText>
          </View>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  titleWrap: {
    flex: 1,
    gap: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  switchRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 10,
  },
  switchChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  smallDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  closeButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  addressText: {
    marginTop: 10,
    opacity: 0.9,
  },
  operatorText: {
    marginTop: 6,
    opacity: 0.8,
  },
  section: {
    marginTop: 16,
    gap: 10,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  actionsRow: {
    marginTop: 18,
  },
  actionPrimary: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 14,
  },
  actionPrimaryText: {
    color: '#0b0b0b',
    fontWeight: '700',
  },
  navSection: {
    marginTop: 16,
    gap: 10,
  },
  navState: {
    gap: 8,
    paddingVertical: 6,
  },
  navList: {
    gap: 10,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  navRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  navIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: 12,
  },
});

