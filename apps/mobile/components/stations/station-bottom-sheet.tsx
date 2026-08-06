import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { getApps } from 'react-native-map-link';

import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { operatorFor } from '@/lib/operators';
import type { Station, StationConnector } from '@/types/stations';

type Props = {
  stations: Station[] | null;
  onClose: () => void;
};

const BRAND = '#22E06B';

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

/** Group identical connectors (type + power) into "N ×" rows. */
type ConnectorRow = { key: string; type: string; powerKw: number; count: number; status: Station['status'] };
function aggregateConnectors(connectors: StationConnector[]): ConnectorRow[] {
  const map = new Map<string, ConnectorRow>();
  const rank = (s: Station['status']) => (s === 'available' ? 0 : s === 'in_use' ? 1 : s === 'unknown' ? 2 : 3);
  for (const c of connectors) {
    const key = `${c.type}|${c.powerKw}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      if (rank(c.status) < rank(existing.status)) existing.status = c.status;
    } else {
      map.set(key, { key, type: c.type, powerKw: c.powerKw, count: 1, status: c.status });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.powerKw - a.powerKw);
}

function formatMoney(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

type NavApp = { id: string; name: string; icon: unknown; open: () => Promise<string | void> };
const APPS_WHITELIST = ['google-maps', 'apple-maps', 'yandex', 'yandex-maps', 'dgis', 'maps-me', 'waze'];

export function StationBottomSheet({ stations, onClose }: Props) {
  const colorScheme = useColorScheme() ?? 'dark';
  const sheetRef = useRef<BottomSheet | null>(null);
  const snapPoints = useMemo(() => [200, 380, '88%'], []);

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
    if (stationsList.length) sheetRef.current.snapToIndex(1);
    else sheetRef.current.close();
  }, [stationsList.length]);

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

  const op = activeStation ? operatorFor(activeStation.operatorId) : null;
  const connectorRows = useMemo(
    () => (activeStation ? aggregateConnectors(activeStation.connectors) : []),
    [activeStation]
  );
  const maxPower = useMemo(
    () => connectorRows.reduce((m, c) => Math.max(m, c.powerKw || 0), 0),
    [connectorRows]
  );
  const totalConnectors = useMemo(
    () => connectorRows.reduce((n, c) => n + c.count, 0),
    [connectorRows]
  );

  async function ensureNavAppsLoaded(s: Station) {
    if (navLoading || navApps.length) return;
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
        {activeStation && op ? (
          <>
            {/* Header: operator logo + name + status */}
            <View style={styles.headerRow}>
              <View style={[styles.logoBox, { borderColor: `${op.color}66` }]}>
                {op.logo ? (
                  <Image source={op.logo} style={styles.logoImg} resizeMode="contain" />
                ) : (
                  <View style={[styles.logoFallback, { backgroundColor: op.color }]}>
                    <ThemedText style={styles.logoFallbackText}>{op.name.slice(0, 1)}</ThemedText>
                  </View>
                )}
              </View>

              <View style={styles.titleWrap}>
                <ThemedText type="subtitle" numberOfLines={2}>
                  {activeStation.name}
                </ThemedText>
                <View style={styles.metaRow}>
                  <ThemedText style={[styles.operatorText, { color: op.color }]} numberOfLines={1}>
                    {op.name}
                  </ThemedText>
                  <View style={styles.statusChip}>
                    <View style={[styles.statusDot, { backgroundColor: statusDotColor(activeStation.status) }]} />
                    <ThemedText style={styles.statusChipText}>{formatStatus(activeStation.status)}</ThemedText>
                  </View>
                </View>
              </View>
            </View>

            {/* Co-located station switcher */}
            {stationsList.length > 1 ? (
              <View style={styles.switchRow}>
                {stationsList.slice(0, 3).map((s) => {
                  const isOn = s.id === activeStation.id;
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => setActiveStationId(s.id)}
                      style={[styles.switchChip, isOn ? { borderColor: `${BRAND}99`, backgroundColor: `${BRAND}1A` } : null]}
                      accessibilityRole="button">
                      <View style={[styles.smallDot, { backgroundColor: statusDotColor(s.status) }]} />
                      <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.switchChipText}>
                        {operatorFor(s.operatorId).name}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {/* Stat cards: price / power / connectors */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <ThemedText style={styles.statValue}>
                  {activeStation.pricing?.perKwh != null ? formatMoney(activeStation.pricing.perKwh) : '—'}
                </ThemedText>
                <ThemedText style={styles.statLabel}>
                  {activeStation.pricing?.perKwh != null ? `${activeStation.pricing.currency ?? 'UZS'} / kWh` : 'Price'}
                </ThemedText>
              </View>
              <View style={styles.statCard}>
                <ThemedText style={styles.statValue}>{maxPower ? `${Math.round(maxPower)}` : '—'}</ThemedText>
                <ThemedText style={styles.statLabel}>{maxPower ? 'kW max' : 'Power'}</ThemedText>
              </View>
              <View style={styles.statCard}>
                <ThemedText style={styles.statValue}>{totalConnectors || '—'}</ThemedText>
                <ThemedText style={styles.statLabel}>Connectors</ThemedText>
              </View>
            </View>

            {activeStation.address ? (
              <View style={styles.addressRow}>
                <ThemedText style={styles.addressText} numberOfLines={2}>
                  {activeStation.address}
                </ThemedText>
              </View>
            ) : null}

            {/* Connectors */}
            {connectorRows.length ? (
              <View style={styles.section}>
                <ThemedText type="defaultSemiBold">Connectors</ThemedText>
                <View style={styles.connectorList}>
                  {connectorRows.map((c) => (
                    <View key={c.key} style={styles.connectorRow}>
                      <View style={[styles.connectorDot, { backgroundColor: statusDotColor(c.status) }]} />
                      <ThemedText type="defaultSemiBold" style={styles.connectorType}>
                        {c.count > 1 ? `${c.count}× ` : ''}
                        {c.type === 'unknown' ? 'Connector' : c.type}
                      </ThemedText>
                      <ThemedText style={styles.connectorPower}>{c.powerKw ? `${Math.round(c.powerKw)} kW` : ''}</ThemedText>
                    </View>
                  ))}
                </View>
                {activeStation.pricing?.parkingFee ? (
                  <ThemedText style={styles.feeText}>
                    Parking/idle fee: {formatMoney(activeStation.pricing.parkingFee)} {activeStation.pricing.currency ?? 'UZS'}
                  </ThemedText>
                ) : null}
              </View>
            ) : null}

            {/* Navigate */}
            <View style={styles.actionsRow}>
              <Pressable
                style={[styles.actionPrimary, { backgroundColor: BRAND }]}
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
                        <ThemedText style={{ color: BRAND }}>Open</ThemedText>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.emptyState}>
            <ThemedText type="defaultSemiBold">Tap a charger</ThemedText>
            <ThemedText>Station details appear here.</ThemedText>
          </View>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  content: { flex: 1, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoBox: {
    width: 52,
    height: 52,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImg: { width: 46, height: 46, borderRadius: 12 },
  logoFallback: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  logoFallbackText: { color: '#fff', fontWeight: '800', fontSize: 20 },
  titleWrap: { flex: 1, gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  operatorText: { fontWeight: '700', fontSize: 13 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusChipText: { fontSize: 13, opacity: 0.9 },
  statusDot: { width: 9, height: 9, borderRadius: 999 },
  switchRow: { marginTop: 12, flexDirection: 'row', gap: 8 },
  switchChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  switchChipText: { fontSize: 13 },
  smallDot: { width: 8, height: 8, borderRadius: 999 },
  statsRow: { marginTop: 16, flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 11, opacity: 0.6, marginTop: 2 },
  addressRow: { marginTop: 14 },
  addressText: { opacity: 0.85, lineHeight: 20 },
  section: { marginTop: 18, gap: 10 },
  connectorList: { gap: 8 },
  connectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  connectorDot: { width: 9, height: 9, borderRadius: 999 },
  connectorType: { flex: 1 },
  connectorPower: { opacity: 0.7 },
  feeText: { marginTop: 4, opacity: 0.6, fontSize: 13 },
  actionsRow: { marginTop: 18 },
  actionPrimary: { alignItems: 'center', justifyContent: 'center', height: 50, borderRadius: 15 },
  actionPrimaryText: { color: '#07120B', fontWeight: '800', fontSize: 15 },
  navSection: { marginTop: 16, gap: 10 },
  navState: { gap: 8, paddingVertical: 6 },
  navList: { gap: 10 },
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
  navRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  navIcon: { width: 26, height: 26, borderRadius: 7 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 12 },
});
