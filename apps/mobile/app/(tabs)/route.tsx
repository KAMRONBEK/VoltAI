import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Location from 'expo-location';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { TAB_BAR_CLEARANCE } from '@/components/floating-tab-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Section } from '@/components/ui/section';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useIsOffline } from '@/hooks/use-is-offline';
import { PLACES, nearestPlace, type Place } from '@/lib/plan/destinations';
import { savedTripsAtom } from '@/lib/plan/plan-history-atoms';
import { formatDuration } from '@/lib/plan/planClient';
import { formatSavedAt, type SavedTrip } from '@/lib/plan/planHistory';
import {
  destPointAtom,
  formatPoint,
  originPointAtom,
  pickTargetAtom,
  placeToPoint,
  type TripPoint,
} from '@/lib/plan/tripPoints';
import { useArrivalReservePct } from '@/lib/settings/appSettings';
import { useThemeColors } from '@/lib/theme/theme-context';
import { PLUG_OPTIONS, derivedSpec, isPlannable } from '@/lib/vehicles/garage';
import {
  carsAtom,
  garageLoadedAtom,
  selectCarAtom,
  selectedCarAtom,
} from '@/lib/vehicles/garage-atoms';

type Style = 'relaxed' | 'normal' | 'fast';

const SOC_STEPS = [20, 30, 40, 50, 60, 70, 80, 90, 100];

/** Trip input: which car, how full, where to. */
export default function PlanInputScreen() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const isOffline = useIsOffline();
  const cars = useAtomValue(carsAtom);
  const selectedCar = useAtomValue(selectedCarAtom);
  const selectCar = useSetAtom(selectCarAtom);
  const isLoaded = useAtomValue(garageLoadedAtom);
  const savedTrips = useAtomValue(savedTripsAtom);
  // Read here so the caption below says what the planner will actually be held to; the value
  // itself is set on the Settings tab and travels to the request inside `fetchPlan`.
  const [arrivalReservePct] = useArrivalReservePct();

  const [origin, setOrigin] = useAtom(originPointAtom);
  const [destination, setDestination] = useAtom(destPointAtom);
  const setPickTarget = useSetAtom(pickTargetAtom);
  const [startSoc, setStartSoc] = useState(80);
  const [style, setStyle] = useState<Style>('normal');
  const [winter, setWinter] = useState(false);

  // Default the origin to the nearest listed city. Best-effort: a denied permission just leaves
  // the default in place. Skipped once the user has picked a point themselves, so location
  // arriving late can never overwrite a deliberate choice.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const pos = await Location.getLastKnownPositionAsync();
        if (!pos || cancelled) return;
        setOrigin((prev) =>
          prev && !prev.placeId
            ? prev
            : placeToPoint(nearestPlace({ lat: pos.coords.latitude, lng: pos.coords.longitude }))
        );
      } catch {
        // Location is a convenience here, never a requirement.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const spec = selectedCar ? derivedSpec(selectedCar) : null;
  const plugLabel = PLUG_OPTIONS.find((p) => p.value === selectedCar?.plug)?.label;

  const destinations = useMemo(
    () => PLACES.filter((p) => p.id !== origin?.placeId),
    [origin?.placeId]
  );

  const openPicker = (target: 'from' | 'to') => {
    setPickTarget(target);
    router.push('/plan/pick');
  };

  const blocked = !isLoaded
    ? 'Loading…'
    : cars.length === 0
      ? 'Add a car first'
      : !selectedCar
        ? 'Choose a car'
        : !isPlannable(selectedCar)
          ? 'Set your car’s connector first'
          : !origin
            ? 'Choose where you are starting'
            : !destination
              ? 'Choose where you are going'
              : null;

  const onPlan = () => {
    if (blocked || !origin || !destination || !selectedCar?.plug) return;
    // Coordinates rather than city ids, so a dropped pin travels the same path as a listed city.
    router.push({
      pathname: '/plan/results',
      params: {
        carId: selectedCar.id,
        fromLat: String(origin.lat),
        fromLng: String(origin.lng),
        fromLabel: origin.label,
        toLat: String(destination.lat),
        toLng: String(destination.lng),
        toLabel: destination.label,
        soc: String(startSoc),
        style,
        temp: winter ? 'winter' : 'mild',
      },
    });
  };

  return (
    <ThemedView style={styles.root}>
      <OfflineBanner visible={isOffline} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE },
        ]}
        keyboardShouldPersistTaps="handled">
        <ThemedText type="title">Plan a trip</ThemedText>

        {/* Above the form on purpose: re-driving a route you have already planned is the most
            common second use of this screen, and it is one tap from here. */}
        {savedTrips.length ? (
          <Section title="Recent trips">
            {savedTrips.slice(0, 3).map((trip) => (
              <RecentTripRow key={trip.id} trip={trip} />
            ))}
            <Pressable onPress={() => router.push('/plan/history')} style={styles.linkRow}>
              <ThemedText style={[styles.linkText, { color: c.tint }]}>
                {savedTrips.length > 3 ? `All ${savedTrips.length} saved trips` : 'Saved trips'}
              </ThemedText>
              <MaterialIcons name="chevron-right" size={20} color={c.tint} />
            </Pressable>
          </Section>
        ) : null}

        <Section title="Car">
          {cars.length === 0 ? (
            <>
              <ThemedText style={[styles.caption, { color: c.textMuted }]}>
                Trip planning needs to know how far your car goes and which chargers fit it.
              </ThemedText>
              <PrimaryButton label="Add a car" onPress={() => router.push('/garage/new')} />
            </>
          ) : (
            <>
              {cars.map((car) => {
                const active = selectedCar?.id === car.id;
                return (
                  <Pressable
                    key={car.id}
                    onPress={() => selectCar(car.id)}
                    style={[
                      styles.optionRow,
                      {
                        backgroundColor: active ? c.surfaceSunken : 'transparent',
                        borderColor: active ? c.tint : c.border,
                      },
                    ]}>
                    <View style={styles.optionText}>
                      <ThemedText style={styles.optionLabel}>{car.label || 'Unnamed car'}</ThemedText>
                      <ThemedText style={[styles.caption, { color: c.textMuted }]}>
                        {derivedSpec(car).realRangeKm} km ·{' '}
                        {car.plug
                          ? `${PLUG_OPTIONS.find((p) => p.value === car.plug)?.label} connector`
                          : 'connector not set'}
                      </ThemedText>
                    </View>
                    <View
                      style={[
                        styles.radio,
                        {
                          borderColor: active ? c.tint : c.border,
                          backgroundColor: active ? c.tint : 'transparent',
                        },
                      ]}
                    />
                  </Pressable>
                );
              })}
              {selectedCar && !isPlannable(selectedCar) ? (
                <Pressable
                  onPress={() => router.push(`/garage/${selectedCar.id}`)}
                  style={[styles.warnRow, { borderColor: c.danger, backgroundColor: c.surfaceSunken }]}>
                  <MaterialIcons name="error-outline" size={18} color={c.danger} />
                  <ThemedText style={[styles.caption, { color: c.danger, flex: 1 }]}>
                    We need to know which connector this car uses — GB/T and CCS2 chargers are not
                    interchangeable. Tap to set it.
                  </ThemedText>
                </Pressable>
              ) : null}
              {spec && plugLabel ? (
                <ThemedText style={[styles.caption, { color: c.textMuted }]}>
                  Planning with {spec.realRangeKm} km of range, {plugLabel} connector, up to{' '}
                  {spec.dcPeakKw} kW · arrive with ≥ {arrivalReservePct} %.
                </ThemedText>
              ) : null}
            </>
          )}
        </Section>

        <Section title="Battery now">
          <View style={styles.chipGrid}>
            {SOC_STEPS.map((value) => (
              <ChoiceChip
                key={value}
                label={`${value}%`}
                selected={startSoc === value}
                onPress={() => setStartSoc(value)}
              />
            ))}
          </View>
        </Section>

        <Section title="From">
          <PickRow point={origin} onPick={() => openPicker('from')} />
          <ChipGrid
            items={PLACES}
            selectedId={origin?.placeId ?? null}
            onSelect={(p) => {
              setOrigin(placeToPoint(p));
              if (destination?.placeId === p.id) setDestination(null);
            }}
          />
        </Section>

        <Section title="To">
          <PickRow point={destination} onPick={() => openPicker('to')} />
          <ChipGrid
            items={destinations}
            selectedId={destination?.placeId ?? null}
            onSelect={(p) => setDestination(placeToPoint(p))}
          />
        </Section>

        <Section title="Conditions">
          <ThemedText style={[styles.caption, { color: c.textMuted }]}>How you drive</ThemedText>
          <SegmentedControl
            options={[
              { value: 'relaxed', label: 'Relaxed' },
              { value: 'normal', label: 'Normal' },
              { value: 'fast', label: 'Fast' },
            ]}
            value={style}
            onChange={setStyle}
          />

          <Pressable
            onPress={() => setWinter((v) => !v)}
            style={[
              styles.toggleRow,
              { borderColor: winter ? c.tint : c.border, backgroundColor: winter ? c.surfaceSunken : 'transparent' },
            ]}>
            <MaterialIcons name="ac-unit" size={18} color={winter ? c.tint : c.textMuted} />
            <ThemedText style={[styles.optionLabel, { flex: 1 }]}>Cold weather</ThemedText>
            <ThemedText style={[styles.caption, { color: c.textMuted }]}>
              {winter ? 'On' : 'Off'}
            </ThemedText>
          </Pressable>
          <ThemedText style={[styles.caption, { color: c.textMuted }]}>
            Cold cuts range noticeably. Turning this on plans more conservatively.
          </ThemedText>
        </Section>

        <PrimaryButton
          label={blocked ?? `Plan ${origin?.label} → ${destination?.label}`}
          onPress={onPlan}
          disabled={Boolean(blocked)}
        />
      </ScrollView>
    </ThemedView>
  );
}

/**
 * The current end of the trip, with a way to drop a pin instead.
 *
 * Shown above the city chips rather than instead of them: the chips stay the fast path for the
 * common intercity case, while the map covers everywhere that is not a city centre.
 */
function PickRow({ point, onPick }: { point: TripPoint | null; onPick: () => void }) {
  const c = useThemeColors();
  const isPin = Boolean(point && !point.placeId);
  return (
    <Pressable
      onPress={onPick}
      style={[
        styles.pickRow,
        { borderColor: isPin ? c.tint : c.border, backgroundColor: c.surfaceSunken },
      ]}>
      <MaterialIcons name={isPin ? 'place' : 'add-location-alt'} size={20} color={isPin ? c.tint : c.textMuted} />
      <View style={styles.pickText}>
        <ThemedText style={styles.pickLabel} numberOfLines={1}>
          {point ? formatPoint(point) : 'Pick a point on the map'}
        </ThemedText>
        <ThemedText style={[styles.caption, { color: c.textMuted }]}>
          {isPin ? 'Tap to move the pin' : 'Tap to choose an exact spot'}
        </ThemedText>
      </View>
      <MaterialIcons name="chevron-right" size={22} color={c.textMuted} />
    </Pressable>
  );
}

/**
 * One previously planned trip. Tapping it re-plans the same journey rather than reopening the
 * stored answer, so a trip driven again picks up today's charger data when there is a connection.
 */
function RecentTripRow({ trip }: { trip: SavedTrip }) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/plan/results', params: trip.params })}
      style={[styles.optionRow, { borderColor: c.border }]}>
      <View style={styles.optionText}>
        <ThemedText style={styles.optionLabel} numberOfLines={1}>
          {trip.params.fromLabel} → {trip.params.toLabel}
        </ThemedText>
        <ThemedText style={[styles.caption, { color: c.textMuted }]}>
          {trip.feasible && trip.totalMin != null
            ? `${formatDuration(trip.totalMin)} · ${trip.stops ?? 0} ${
                trip.stops === 1 ? 'stop' : 'stops'
              }`
            : 'Not possible with this car'}{' '}
          · {formatSavedAt(trip.savedAt)}
        </ThemedText>
      </View>
      <MaterialIcons name="chevron-right" size={22} color={c.textMuted} />
    </Pressable>
  );
}

function ChipGrid({
  items,
  selectedId,
  onSelect,
}: {
  items: Place[];
  selectedId: string | null;
  onSelect: (place: Place) => void;
}) {
  return (
    <View style={styles.chipGrid}>
      {items.map((place) => (
        <ChoiceChip
          key={place.id}
          label={place.name}
          selected={place.id === selectedId}
          onPress={() => onSelect(place)}
        />
      ))}
    </View>
  );
}


const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 18 },
  caption: { fontSize: 13, lineHeight: 18 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionText: { flex: 1, gap: 2 },
  optionLabel: { fontSize: 15, fontWeight: '700' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  linkText: { fontSize: 14, fontWeight: '700' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
  warnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pickText: { flex: 1, gap: 2 },
  pickLabel: { fontSize: 15, fontWeight: '700' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
