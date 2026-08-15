import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { getApps } from 'react-native-map-link';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from '@/components/floating-tab-bar';
import { ThemedText } from '@/components/themed-text';
import { StatusDot } from '@/components/ui/status-dot';
import { categoryInfo } from '@/lib/categories';
import { operatorFor } from '@/lib/operators';
import { useThemeColors } from '@/lib/theme/theme-context';
import type { Station, StationConnector } from '@/types/stations';

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

/**
 * A directions link that needs no package visibility at all.
 *
 * `getApps` detects apps with `canOpenURL`, which on Android 11+ only sees schemes declared in the
 * manifest's `<queries>` (app.config.ts declares the common ones, but not every navigator). Firing
 * a plain `geo:` intent is different — starting an intent is not querying for one — so Android
 * shows its own chooser of every installed map app. iOS gets Apple Maps' universal link.
 */
function fallbackNavUrl(s: Station): string {
  const { latitude: lat, longitude: lng } = s.location;
  // `encodeURIComponent` leaves `(` and `)` alone, and the `geo:` label is itself wrapped in
  // parentheses — a name like "Spectre (Yunusobod)" would close the label early.
  const label = encodeURIComponent(s.name).replace(/[()]/g, (ch) => '%' + ch.charCodeAt(0).toString(16));
  return Platform.OS === 'ios'
    ? `http://maps.apple.com/?ll=${lat},${lng}&q=${label}`
    : `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
}

export function StationBottomSheet({ stations, onClose }: Props) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
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
    if (stationsIdsKey) sheetRef.current.snapToIndex(1);
    else sheetRef.current.close();
  }, [stationsIdsKey]);

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

  /**
   * Hand the coordinate to whatever map app the user has. Several detected → show the picker;
   * exactly one → open it; none → the `geo:` / Apple Maps fallback. On Android the Google entry is
   * always "found" (it is an https link), so it alone counts as none: the `geo:` chooser then lists
   * Google Maps *and* anything else installed, instead of silently preferring Google.
   */
  async function openNav(s: Station) {
    if (navLoading) return;
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
      }).catch(() => [])) as NavApp[];

      const detected = Platform.OS === 'android' ? list.filter((a) => a.id !== 'google-maps') : list;
      if (detected.length > 1) {
        setNavApps(list);
        setShowNavApps(true);
        sheetRef.current?.snapToIndex(2);
        return;
      }
      if (detected.length === 1 && Platform.OS !== 'android') {
        await detected[0].open();
        return;
      }
      await Linking.openURL(fallbackNavUrl(s));
    } catch {
      setNavError('Could not open a navigation app. Install one (Yandex Navigator, 2GIS, Google Maps…) and try again.');
      setShowNavApps(true);
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
      backgroundStyle={[styles.sheetBackground, { backgroundColor: c.background }]}
      handleIndicatorStyle={{ backgroundColor: c.handle }}>
      <BottomSheetScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }]}
        showsVerticalScrollIndicator={false}>
        {activeStation && op ? (
          <>
            {/* Header: operator logo + name + status */}
            <View style={styles.headerRow}>
              <View style={[styles.logoBox, { borderColor: `${op.color}66` }]}>
                {op.logo ? (
                  <Image source={op.logo} style={styles.logoImg} resizeMode="contain" />
                ) : (
                  <View style={[styles.logoFallback, { backgroundColor: `${op.color}22`, borderColor: op.color }]}>
                    <ThemedText style={[styles.logoFallbackText, { color: op.color }]}>{op.name.slice(0, 1)}</ThemedText>
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
                    <StatusDot status={activeStation.status} />
                    <ThemedText style={styles.statusChipText}>{formatStatus(activeStation.status)}</ThemedText>
                  </View>
                </View>
                {(() => {
                  const cat = categoryInfo(activeStation.category);
                  const kw = activeStation.maxPowerKw;
                  return (
                    <View style={[styles.catChip, { backgroundColor: `${cat.color}22`, borderColor: `${cat.color}77` }]}>
                      <View style={[styles.catDot, { backgroundColor: cat.color }]} />
                      <ThemedText style={[styles.catText, { color: cat.color }]}>
                        {cat.label}
                        {kw ? ` · ${Math.round(kw)} kW` : ''}
                      </ThemedText>
                    </View>
                  );
                })()}
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
                      style={[
                        styles.switchChip,
                        { backgroundColor: c.surface, borderColor: c.border },
                        isOn ? { borderColor: c.tint, backgroundColor: `${c.tint}1A` } : null,
                      ]}
                      accessibilityRole="button">
                      <StatusDot status={s.status} />
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
              <View style={[styles.statCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <ThemedText style={styles.statValue}>
                  {activeStation.pricing?.perKwh != null ? formatMoney(activeStation.pricing.perKwh) : '—'}
                </ThemedText>
                <ThemedText style={[styles.statLabel, { color: c.textMuted }]}>
                  {activeStation.pricing?.perKwh != null ? `${activeStation.pricing.currency ?? 'UZS'} / kWh` : 'Price'}
                </ThemedText>
              </View>
              <View style={[styles.statCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <ThemedText style={styles.statValue}>{maxPower ? `${Math.round(maxPower)}` : '—'}</ThemedText>
                <ThemedText style={[styles.statLabel, { color: c.textMuted }]}>{maxPower ? 'kW max' : 'Power'}</ThemedText>
              </View>
              <View style={[styles.statCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <ThemedText style={styles.statValue}>{totalConnectors || '—'}</ThemedText>
                <ThemedText style={[styles.statLabel, { color: c.textMuted }]}>Connectors</ThemedText>
              </View>
            </View>

            {activeStation.address ? (
              <View style={styles.addressRow}>
                <ThemedText style={[styles.addressText, { color: c.textMuted }]} numberOfLines={2}>
                  {activeStation.address}
                </ThemedText>
              </View>
            ) : null}

            {/* Connectors */}
            {connectorRows.length ? (
              <View style={styles.section}>
                <ThemedText type="defaultSemiBold">Connectors</ThemedText>
                <View style={styles.connectorList}>
                  {connectorRows.map((conn) => (
                    <View key={conn.key} style={[styles.connectorRow, { backgroundColor: c.surface, borderColor: c.border }]}>
                      <StatusDot status={conn.status} />
                      <ThemedText type="defaultSemiBold" style={styles.connectorType}>
                        {conn.count > 1 ? `${conn.count}× ` : ''}
                        {conn.type === 'unknown' ? 'Connector' : conn.type}
                      </ThemedText>
                      <ThemedText style={[styles.connectorPower, { color: c.textMuted }]}>{conn.powerKw ? `${Math.round(conn.powerKw)} kW` : ''}</ThemedText>
                    </View>
                  ))}
                </View>
                {activeStation.pricing?.parkingFee ? (
                  <ThemedText style={[styles.feeText, { color: c.textMuted }]}>
                    Parking/idle fee: {formatMoney(activeStation.pricing.parkingFee)} {activeStation.pricing.currency ?? 'UZS'}
                  </ThemedText>
                ) : null}
              </View>
            ) : null}

            {/* Navigate */}
            <View style={styles.actionsRow}>
              <Pressable
                style={[styles.actionPrimary, { backgroundColor: c.accent }]}
                disabled={navLoading}
                onPress={() => {
                  if (showNavApps) {
                    setShowNavApps(false);
                    return;
                  }
                  void openNav(activeStation);
                }}
                accessibilityRole="button">
                {navLoading ? (
                  <ActivityIndicator color={c.onAccent} />
                ) : (
                  <ThemedText style={[styles.actionPrimaryText, { color: c.onAccent }]}>
                    {showNavApps ? 'Hide navigation apps' : 'Navigate'}
                  </ThemedText>
                )}
              </Pressable>
            </View>

            {showNavApps ? (
              <View style={styles.navSection}>
                {navError ? (
                  <View style={styles.navState}>
                    <ThemedText type="defaultSemiBold">Couldn’t open directions</ThemedText>
                    <ThemedText>{navError}</ThemedText>
                  </View>
                ) : null}
                <View style={styles.navList}>
                  {navApps.map((app) => (
                    <Pressable
                      key={app.id}
                      style={[styles.navRow, { backgroundColor: c.surface, borderColor: c.border }]}
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
                      <ThemedText style={{ color: c.tint }}>Open</ThemedText>
                    </Pressable>
                  ))}
                  {/* The system chooser, for navigators the picker could not see. */}
                  <Pressable
                    style={[styles.navRow, { backgroundColor: c.surface, borderColor: c.border }]}
                    onPress={() =>
                      Linking.openURL(fallbackNavUrl(activeStation)).catch(() =>
                        setNavError('No app on this phone can open a map location.')
                      )
                    }
                    accessibilityRole="button">
                    <View style={styles.navRowLeft}>
                      <View style={[styles.navIcon, styles.navIconFallback, { borderColor: c.border }]}>
                        <MaterialIcons name="map" size={16} color={c.icon} />
                      </View>
                      <ThemedText type="defaultSemiBold">Other app…</ThemedText>
                    </View>
                    <ThemedText style={{ color: c.tint }}>Open</ThemedText>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.emptyState}>
            <ThemedText type="defaultSemiBold">Tap a charger</ThemedText>
            <ThemedText>Station details appear here.</ThemedText>
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 20 },
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
  logoFallback: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoFallbackText: { fontWeight: '800', fontSize: 20 },
  titleWrap: { flex: 1, gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  operatorText: { fontWeight: '700', fontSize: 13 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusChipText: { fontSize: 13 },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  catDot: { width: 7, height: 7, borderRadius: 999 },
  catText: { fontSize: 12, fontWeight: '800' },
  switchRow: { marginTop: 12, flexDirection: 'row', gap: 8 },
  switchChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  switchChipText: { fontSize: 13 },
  statsRow: { marginTop: 16, flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 11, marginTop: 2 },
  addressRow: { marginTop: 14 },
  addressText: { lineHeight: 20 },
  section: { marginTop: 18, gap: 10 },
  connectorList: { gap: 8 },
  connectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  connectorType: { flex: 1 },
  connectorPower: {},
  feeText: { marginTop: 4, fontSize: 13 },
  actionsRow: { marginTop: 18 },
  actionPrimary: { alignItems: 'center', justifyContent: 'center', height: 50, borderRadius: 14 },
  actionPrimaryText: { fontWeight: '800', fontSize: 16 },
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
    borderWidth: StyleSheet.hairlineWidth,
  },
  navRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  navIcon: { width: 26, height: 26, borderRadius: 7 },
  navIconFallback: { borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 12 },
});
