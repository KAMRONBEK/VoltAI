import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import BottomSheet, { BottomSheetScrollView, BottomSheetView } from '@gorhom/bottom-sheet';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useAtomValue, useSetAtom } from 'jotai';
import { Marker, Polyline, YandexMapView, type YandexMapViewRef } from 'expo-yandex-mapkit';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getApps } from 'react-native-map-link';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppSheet, SHEET_PADDING_H, useSheetChrome } from '@/components/ui/app-sheet';
import { PrimaryButton } from '@/components/ui/primary-button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Tag } from '@/components/ui/tag';
import { MapInk } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useIsOffline } from '@/hooks/use-is-offline';
import { saveTripAtom } from '@/lib/plan/plan-history-atoms';
import {
  PlanError,
  effectivePowerKw,
  fetchPlan,
  formatDuration,
  stopKmPerHour,
  type PlanChargingStop,
  type PlanOption,
  type PlanResponse,
} from '@/lib/plan/planClient';
import {
  describeSpecDrift,
  formatSavedAt,
  loadSavedPlan,
  tripId,
  type TripParams,
} from '@/lib/plan/planHistory';
import { decodePolyline, simplify, type Point } from '@/lib/routing/polyline';
import { useThemeColors } from '@/lib/theme/theme-context';
import { effectiveRangeKm } from '@/lib/vehicles/garage';
import { carByIdAtom } from '@/lib/vehicles/garage-atoms';

type NavApp = { id: string; name: string; icon: unknown; open: () => Promise<string | void> };
/** Same whitelist the station sheet uses, so the planner offers the apps people already have. */
const NAV_APPS_WHITELIST = ['google-maps', 'apple-maps', 'yandex', 'yandex-maps', 'dgis', 'maps-me', 'waze'];

const OPTION_LABELS: Record<PlanOption['id'], string> = {
  fastest: 'Fastest',
  'fewest-stops': 'Fewest stops',
  'most-buffer': 'Most buffer',
};

/**
 * The itinerary sheet's detents, as fractions of the screen below the header. Peek at the map,
 * read the plan, read the whole list. Opens on the middle one — the same 62% the old fixed panel
 * was capped at, so the first frame shows what it always showed.
 */
const SHEET_SNAP_FRACTIONS = [0.34, 0.62, 0.92] as const;
const SHEET_SNAP_POINTS = SHEET_SNAP_FRACTIONS.map((f) => `${Math.round(f * 100)}%`);
const SHEET_INITIAL_INDEX = 1;

/**
 * Trip results: the route on its own map, plus the itinerary.
 *
 * Deliberately a second `YandexMapView` instance rather than reusing the tab map. The tab map
 * carries ~1000 clustered station markers whose `markers` memo depends only on `stationGroups` —
 * a load-bearing performance invariant. Feeding a route into it would widen that dependency and
 * re-cluster the whole catalog on every plan.
 */
export default function PlanResultsScreen() {
  const c = useThemeColors();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const isOffline = useIsOffline();
  const chrome = useSheetChrome();
  const mapRef = useRef<YandexMapViewRef | null>(null);
  const params = useLocalSearchParams<TripParams>();

  const getCar = useAtomValue(carByIdAtom);
  const persistTrip = useSetAtom(saveTripAtom);
  const car = getCar(String(params.carId));

  // Coordinates, not city ids — a dropped pin is a first-class trip end.
  const from = useMemo(() => {
    const lat = Number(params.fromLat);
    const lng = Number(params.fromLng);
    return Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng, name: params.fromLabel || 'Start' }
      : null;
  }, [params.fromLat, params.fromLng, params.fromLabel]);

  const to = useMemo(() => {
    const lat = Number(params.toLat);
    const lng = Number(params.toLng);
    return Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng, name: params.toLabel || 'Destination' }
      : null;
  }, [params.toLat, params.toLng, params.toLabel]);

  /** The stop whose detail sheet is open, if any. */
  const [openStopId, setOpenStopId] = useState<string | null>(null);
  /**
   * Height of the area the itinerary sheet lives in (everything under the header), measured — the
   * sheet's detents are percentages of it, and the map frames the route above the sheet, so a
   * hardcoded guess was wrong here on every phone that was not the one it was guessed on.
   */
  const [containerHeight, setContainerHeight] = useState(0);
  /** Which detent the itinerary sheet is resting at. */
  const [sheetIndex, setSheetIndex] = useState(SHEET_INITIAL_INDEX);

  // Bad navigation params are a property of the params, not an event — so this is derived during
  // render rather than pushed into state by an effect, which would cause a cascading re-render.
  // A saved trip can outlive the car it was planned for, so that case gets its own wording.
  const inputError = !car
    ? { message: 'The car this trip was planned for is no longer in your garage.', reason: 'no-car' }
    : !car.plug
      ? { message: 'Set which connector this car uses before planning with it.', reason: 'plug-required' }
      : !from || !to
        ? { message: 'That trip is missing a start or a destination.', reason: 'bad-input' }
        : null;

  /** Stable identity of this trip on disk — the same string the saved-trip list is keyed by. */
  const id = tripId(params);

  /**
   * Retrying is a new attempt at the same trip, so it cannot be expressed by the params alone.
   * `router.replace` with identical params does not remount this screen, which left the old
   * "Try again" button doing nothing at all.
   */
  const [attempt, setAttempt] = useState(0);

  /**
   * The result is tagged with the request that produced it, so "loading" is derived from
   * `result.key !== requestKey` rather than assigned. That keeps every setState inside an async
   * callback — resetting state synchronously at the top of the effect would spend an extra render
   * pass on every params change, which the lint rule correctly objects to.
   */
  const requestKey = `${id}#${attempt}`;

  type Result = {
    key: string;
    plan?: PlanResponse;
    /** Set when the plan came off disk because the planner could not be reached. */
    savedAt?: string;
    /** Set when that saved plan was computed for a car spec that has since been edited. */
    drift?: string;
    error?: { message: string; reason: string };
  };
  const [result, setResult] = useState<Result | null>(null);
  const [optionIndex, setOptionIndex] = useState(0);

  const current = result?.key === requestKey ? result : null;
  const plan = current?.plan ?? null;
  const savedAt = current?.savedAt ?? null;
  const drift = current?.drift ?? null;
  const isLoading = !inputError && !current;
  const error = inputError ?? current?.error ?? null;
  /** Failures no amount of retrying fixes: the car itself is the problem. */
  const garageError =
    error?.reason === 'no-car' ||
    error?.reason === 'plug-required' ||
    error?.reason === 'car-changed' ||
    // `invalid-range`, `invalid-dcKw`, `invalid-consWhKm`, …: a saved figure the server refused.
    (error?.reason.startsWith('invalid-') ?? false);

  useEffect(() => {
    let cancelled = false;
    if (!car?.plug || !from || !to) return;
    // Captured before the closure: TypeScript keeps a narrowed `const`, but not a narrowed
    // property of one, since the object could in principle be reassigned before the async body runs.
    const plug = car.plug;

    void (async () => {
      try {
        const res = await fetchPlan({
          from: { lat: from.lat, lng: from.lng },
          to: { lat: to.lat, lng: to.lng },
          rangeKm: effectiveRangeKm(car),
          startSocPct: Number(params.soc) || 80,
          plug,
          dcKw: car.dcPeakKw,
          consWhKm: car.consWhKm,
          curve: car.curvePreset,
          style: (params.style as 'relaxed' | 'normal' | 'fast') ?? 'normal',
          temp: (params.temp as 'mild' | 'winter') ?? 'mild',
        });
        if (cancelled) return;
        setResult({ key: requestKey, plan: res });

        // Store the plan whole, polyline included: the point of saving it is to still have it
        // where there is no signal, which is precisely where it cannot be re-fetched.
        const best = res.options[0] ?? null;
        void persistTrip({
          trip: {
            id,
            params: { ...params },
            carLabel: car.label,
            feasible: res.feasible,
            distanceKm: res.distanceKm,
            totalMin: best?.totalMin ?? null,
            stops: best?.stops ?? null,
          },
          plan: res,
        });
      } catch (err: unknown) {
        if (cancelled) return;
        const pe = err instanceof PlanError ? err : null;

        // A trip already under way must survive losing signal. Fall back to the copy saved the
        // last time this exact trip was planned — labelled as saved, never dressed up as live.
        // Every 400 is excluded on purpose: the server rejecting the query means the saved answer
        // is about a question we now know we asked wrongly.
        const reusable = pe?.httpStatus !== 400;
        const saved = reusable ? await loadSavedPlan(id).catch(() => null) : null;
        if (cancelled) return;

        if (saved) {
          // The car can have been edited since. A plan built for another connector is not stale,
          // it is wrong, so it is withheld rather than shown with a caveat.
          // Compared against the *effective* range, which is what was sent and echoed back — a
          // sticker-sourced car has ×0.72 applied, and comparing the raw figure would report
          // drift on every such car on every restore.
          const drift = describeSpecDrift(saved.plan, { ...car, rangeKm: effectiveRangeKm(car) });
          if (drift?.blocking) {
            setResult({ key: requestKey, error: { message: drift.message, reason: 'car-changed' } });
            return;
          }
          setResult({
            key: requestKey,
            plan: saved.plan,
            savedAt: saved.savedAt,
            drift: drift?.message,
          });
          return;
        }

        setResult({
          key: requestKey,
          error: {
            message: pe?.message ?? 'Something went wrong while planning.',
            reason: pe?.reason ?? 'unknown',
          },
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  // Clamp rather than reset in an effect: a new plan may carry fewer options than the one the
  // user had selected, and an out-of-range index would blank the sheet.
  const safeIndex = Math.min(optionIndex, Math.max(0, (plan?.options.length ?? 1) - 1));
  const option = plan?.options[safeIndex] ?? null;
  const openStop = option?.chargingStops.find((s) => s.siteId === openStopId) ?? null;
  // Reserve the plan was actually held to (`reserve` on new backends; the echoed request value on
  // slightly older ones; nothing on backends that predate reserves).
  const reserveTargetPct = plan?.reserve?.destinationPct ?? plan?.vehicle.assumed.reservePct ?? null;

  // Real road geometry when we have it; otherwise a straight line drawn dashed, so an estimated
  // route can never be mistaken for a surveyed one.
  // Hoisted out of the memo so the compiler's inferred dependency matches the declared one —
  // an optional-chained member read inside the body infers as `plan.polyline`, which does not.
  const polyline = plan?.polyline;
  const routePoints: Point[] = useMemo(() => {
    if (polyline) return simplify(decodePolyline(polyline));
    if (from && to) {
      return [
        { latitude: from.lat, longitude: from.lng },
        { latitude: to.lat, longitude: to.lng },
      ];
    }
    return [];
  }, [polyline, from, to]);

  /**
   * Whether the line on the map is a real road.
   *
   * Keyed on having a decoded polyline, not on `geometryTrusted` alone: with no plan loaded — the
   * first seconds of every trip, the whole of a failed one, and the retry window — that flag is
   * `undefined`, and the straight Tashkent–Qarshi line was being drawn solid, exactly as if it
   * were a surveyed route across 450 km of desert.
   */
  const routeIsSurveyed = Boolean(polyline) && plan?.geometryTrusted !== false;

  /**
   * How much of the screen the sheet covers, for framing the route above it. The top detent is
   * "read the list" mode — the map is all but hidden — so it keeps the framing of the one below
   * rather than squeezing 450 km of route into the top 8% of the screen.
   */
  const sheetHeight = Math.round(SHEET_SNAP_FRACTIONS[Math.max(0, Math.min(sheetIndex, 1))] * containerHeight);

  useEffect(() => {
    if (!routePoints.length || !containerHeight) return;
    const timer = setTimeout(() => {
      void mapRef.current?.fitMarkers(routePoints, {
        edgePadding: { top: 90, left: 48, right: 48, bottom: sheetHeight + 24 },
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [routePoints, sheetHeight, containerHeight]);

  /**
   * The stop the detail sheet is showing. Kept one step behind `openStop` on purpose: when the
   * sheet is closed `openStop` is already null, and the card would blank out mid-animation.
   * Adjusted during render rather than in an effect — the sanctioned way to derive state.
   */
  const [shownStop, setShownStop] = useState<PlanChargingStop | null>(null);
  if (openStop && openStop !== shownStop) setShownStop(openStop);
  const shownStopIndex = shownStop && option ? option.chargingStops.indexOf(shownStop) + 1 : 0;

  const title = from && to ? `${from.name} → ${to.name}` : 'Trip';

  return (
    <ThemedView
      style={styles.root}
      onLayout={(e) => {
        const h = Math.round(e.nativeEvent.layout.height);
        setContainerHeight((prev) => (Math.abs(prev - h) < 4 ? prev : h));
      }}>
      <Stack.Screen options={{ title, headerShown: true }} />

      <YandexMapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        animated={false}
        nightMode={colorScheme === 'dark'}
        mapPadding={{ bottom: insets.bottom + 300 }}>
        {routePoints.length > 1 ? (
          <Polyline
            points={routePoints}
            // An estimate is drawn grey, thin AND dashed — three signals, because mistaking a
            // straight line across 450 km of desert for a surveyed road is the expensive error.
            // The dash lengths are always passed explicitly, never spread in conditionally: the
            // native view does not reset a prop that disappears, so a line that dashed once would
            // otherwise stay dashed for the rest of the screen's life. 0 is MapKit's "solid".
            strokeColor={routeIsSurveyed ? c.tint : c.textMuted}
            strokeWidth={routeIsSurveyed ? 6 : 4}
            dashLength={routeIsSurveyed ? 0 : 14}
            gapLength={routeIsSurveyed ? 0 : 8}
            outlineColor={c.background}
            outlineWidth={2}
          />
        ) : null}
        {/* `Marker` with children, not `MarkerView`: Marker snapshots its children into a native
            placemark — the same path the tab map uses for ~1000 station pins. MarkerView instead
            projects world->screen in JS and renders nothing until that projection resolves, which
            is why the pins were invisible. Static numbered pins do not need a live RN view. */}
        {option?.chargingStops.map((stop, i) => (
          <Marker
            key={stop.siteId}
            point={{ latitude: stop.lat, longitude: stop.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={20}
            identifier={stop.siteId}
            onPress={() => setOpenStopId(stop.siteId)}>
            <View style={[styles.pin, { backgroundColor: c.tint, borderColor: c.background }]}>
              <ThemedText style={[styles.pinText, { color: c.onAccent }]}>{i + 1}</ThemedText>
            </View>
          </Marker>
        ))}
        {from ? (
          <Marker point={{ latitude: from.lat, longitude: from.lng }} anchor={{ x: 0.5, y: 0.5 }} zIndex={15}>
            <View style={[styles.endPin, { backgroundColor: MapInk.paper, borderColor: MapInk.ink }]} />
          </Marker>
        ) : null}
        {to ? (
          <Marker point={{ latitude: to.lat, longitude: to.lng }} anchor={{ x: 0.5, y: 0.5 }} zIndex={15}>
            <View style={[styles.endPin, { backgroundColor: MapInk.ink, borderColor: MapInk.paper }]} />
          </Marker>
        ) : null}
      </YandexMapView>

      {/* The itinerary: a sheet over the map, never a modal — the map underneath stays live, and
          the sheet cannot be swiped away, only peeked (34%) or opened out (92%). Everything that
          must stay in view while the stops scroll — the saved-plan notice, the option tabs, the
          totals — is the sheet's fixed header; the stops themselves scroll beneath it. */}
      <BottomSheet
        index={SHEET_INITIAL_INDEX}
        snapPoints={SHEET_SNAP_POINTS}
        enableDynamicSizing={false}
        enablePanDownToClose={false}
        onChange={setSheetIndex}
        accessibilityLabel="Trip itinerary"
        {...chrome}>
        {isLoading ? (
          <BottomSheetView style={styles.centered}>
            <ActivityIndicator color={c.tint} />
            <ThemedText style={[styles.caption, { color: c.textMuted }]}>
              Working out where to stop…
            </ThemedText>
          </BottomSheetView>
        ) : error ? (
          <BottomSheetView style={styles.centered}>
            <MaterialIcons
              name={garageError ? 'directions-car' : 'cloud-off'}
              size={26}
              color={c.textMuted}
            />
            <ThemedText style={styles.headline}>Could not plan this trip</ThemedText>
            <ThemedText style={[styles.caption, { color: c.textMuted, textAlign: 'center' }]}>
              {error.message}
            </ThemedText>
            {/* Retrying re-runs the same request, so it is only offered when the request is the
                thing that failed. A trip whose car was deleted or edited needs the garage. */}
            <PrimaryButton
              label={garageError ? 'Open your garage' : 'Try again'}
              onPress={() => (garageError ? router.push('/garage') : setAttempt((n) => n + 1))}
              style={styles.buttonSpacing}
            />
          </BottomSheetView>
        ) : plan && !plan.feasible ? (
          <BottomSheetScrollView
            contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + 24 }]}
            showsVerticalScrollIndicator={false}>
            {savedAt ? (
              <SavedPlanBanner savedAt={savedAt} drift={drift} onRefresh={() => setAttempt((n) => n + 1)} />
            ) : null}
            <View style={styles.headlineRow}>
              <MaterialIcons name="report-problem" size={22} color={c.danger} />
              <ThemedText style={styles.headline}>
                {savedAt ? 'This trip was not possible' : 'This trip is not possible yet'}
              </ThemedText>
            </View>
            {plan.blockingGap ? (
              <>
                <ThemedText style={[styles.body, { color: c.text }]}>
                  {plan.blockingGap.reason}
                </ThemedText>
                {plan.blockingGap.endsAtDestination ? (
                  <ThemedText style={[styles.caption, { color: c.textMuted }]}>
                    There is no charger anywhere inside that stretch, and it runs all the way to
                    your destination — so there is nowhere to top up if you run low.
                  </ThemedText>
                ) : null}
              </>
            ) : null}
            {plan.suggestions?.map((s) => (
              <ThemedText key={s} style={[styles.caption, { color: c.textMuted }]}>
                • {s}
              </ThemedText>
            ))}
          </BottomSheetScrollView>
        ) : plan && option ? (
          <View style={styles.sheetBody}>
            <View style={styles.sheetHeader}>
              {savedAt ? (
                <SavedPlanBanner savedAt={savedAt} drift={drift} onRefresh={() => setAttempt((n) => n + 1)} />
              ) : null}

              {plan.options.length > 1 ? (
                <SegmentedControl
                  options={plan.options.map((opt) => ({ value: opt.id, label: OPTION_LABELS[opt.id] }))}
                  value={option.id}
                  onChange={(id) => setOptionIndex(plan.options.findIndex((opt) => opt.id === id))}
                />
              ) : null}

              <View style={styles.summaryRow}>
                <ThemedText style={styles.bigTime}>{formatDuration(option.totalMin)}</ThemedText>
                <ThemedText style={[styles.caption, { color: c.textMuted }]}>
                  {Math.round(option.distanceKm)} km · {option.stops}{' '}
                  {option.stops === 1 ? 'stop' : 'stops'}
                </ThemedText>
              </View>

              {/* The arrival promise, stated against the reserve the plan was held to. The planner
                  never plans a leg that ends below the reserve, so a lower number here means the
                  backend predates reserves (no `reserve` field) — show only what we know. */}
              <View style={styles.arrivalRow}>
                <ThemedText type="defaultSemiBold" style={{ color: arrivalTone(option.arriveSocPct, reserveTargetPct, c) }}>
                  Arrive with {Math.round(option.arriveSocPct)}% battery
                </ThemedText>
                {reserveTargetPct != null ? (
                  <ThemedText style={[styles.caption, { color: c.textMuted }]}>
                    {' '}· reserve target ≥ {Math.round(reserveTargetPct)}%
                  </ThemedText>
                ) : null}
              </View>

              <ThemedText style={[styles.caption, { color: c.textMuted }]}>
                {formatDuration(option.driveMin)} driving ·{' '}
                {formatDuration(option.chargeMin + option.plugMin)} charging
                {option.waitMin ? ` · ${formatDuration(option.waitMin)} queueing` : ''}
                {option.terminalMin ? ` · ${formatDuration(option.terminalMin)} start/finish` : ''}
              </ThemedText>
            </View>

            <BottomSheetScrollView
              style={styles.sheetScroll}
              contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + 24 }]}
              showsVerticalScrollIndicator={false}>
              {/* Honesty chips: never let an estimate look like a measurement. */}
              <View style={styles.chipRow}>
                {!plan.geometryTrusted ? (
                  <Tag tone="warn" text="Estimated route — distances approximate" />
                ) : null}
                {plan.relaxations.length ? <Tag tone="warn" text={plan.relaxations[0]} /> : null}
                {/* Only meaningful on a live answer: on a restored plan this is how old the data
                    was when it was saved, which is not what a driver would read it as. */}
                {!savedAt && plan.dataAgeSec != null && plan.dataAgeSec > 900 ? (
                  <Tag
                    tone="muted"
                    text={`Charger data ${Math.round(plan.dataAgeSec / 60)} min old`}
                  />
                ) : null}
                {plan.diagnostics.unverifiedGatekeepers > 0 ? (
                  <Tag tone="warn" text="A required stop’s power is unconfirmed" />
                ) : null}
              </View>

              {option.chargingStops.map((stop, i) => {
                const rate = stopKmPerHour(stop, plan.vehicle.planningRangeKm);
                const power = effectivePowerKw(stop.gunKw, plan.vehicle.assumed.dcPeakKw);
                return (
                  <Pressable
                    key={stop.siteId}
                    onPress={() => setOpenStopId(stop.siteId)}
                    accessibilityRole="button"
                    style={[styles.stopCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                    <View style={styles.stopHeader}>
                      <View style={[styles.stopIndex, { backgroundColor: c.tint }]}>
                        <ThemedText style={[styles.stopIndexText, { color: c.onAccent }]}>
                          {i + 1}
                        </ThemedText>
                      </View>
                      <ThemedText style={styles.stopName} numberOfLines={2}>
                        {stop.name}
                      </ThemedText>
                    </View>

                    <ThemedText style={[styles.body, { color: c.text }]}>
                      Arrive {Math.round(stop.arriveSocPct)}% · charge{' '}
                      {formatDuration(stop.chargeMin)} · leave {Math.round(stop.departSocPct)}%
                    </ThemedText>

                    {/* km/h of range, not kW: this is the number that explains why the plan leaves
                        before the battery is full. Both figures describe what THIS car gets here —
                        the gun's rating on its own would promise a speed the car cannot accept. */}
                    {power ? (
                      <ThemedText style={[styles.caption, { color: c.textMuted }]}>
                        {power.kw} kW{power.carLimited ? ' — your car’s limit' : ''}
                        {rate ? `, adding about ${rate} km of range per hour here` : ''}
                      </ThemedText>
                    ) : null}

                    <View style={styles.chipRow}>
                      {stop.gatekeeper ? <Tag tone="warn" text="Unavoidable stop" /> : null}
                      {stop.powerConfidence === 'inferred' ? (
                        <Tag tone="muted" text="Power unconfirmed" />
                      ) : null}
                      {/* Occupancy is a snapshot. On a restored plan it is a snapshot of an
                          unknown moment in the past, so it is dropped rather than shown. */}
                      {!savedAt && stop.liveStatus === 'busy' ? (
                        <Tag tone="muted" text="Busy recently" />
                      ) : null}
                      {stop.lateralKm > 1 ? (
                        <Tag tone="muted" text={`${stop.lateralKm.toFixed(1)} km off route`} />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}

              {/* Destination row: the number the whole plan is built around. */}
              <View style={[styles.stopCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <View style={styles.stopHeader}>
                  <View style={[styles.stopIndex, { backgroundColor: c.text }]}>
                    <ThemedText style={[styles.stopIndexText, { color: c.background }]}>⚑</ThemedText>
                  </View>
                  <ThemedText type="defaultSemiBold" numberOfLines={1}>
                    Destination
                  </ThemedText>
                </View>
                <ThemedText style={{ color: arrivalTone(option.arriveSocPct, reserveTargetPct, c) }}>
                  Arrive with {Math.round(option.arriveSocPct)}% battery
                  {reserveTargetPct != null ? ` — planned to keep at least ${Math.round(reserveTargetPct)}%` : ''}
                </ThemedText>
                {reserveTargetPct != null ? (
                  <ThemedText style={[styles.caption, { color: c.textMuted }]}>
                    Change the reserve under Settings › Trip planning.
                  </ThemedText>
                ) : null}
              </View>

              <View style={[styles.whyCard, { borderColor: c.border }]}>
                <ThemedText style={[styles.caption, { color: c.textMuted }]}>
                  Why these stops: charging slows down as the battery fills, so we leave each charger
                  the moment it starts giving you less than the next one would.
                </ThemedText>
              </View>
            </BottomSheetScrollView>
          </View>
        ) : null}
      </BottomSheet>

      {/* One charger, opened from its pin or its card. A modal sheet over the itinerary sheet:
          same chrome, plus a backdrop, so it is unmistakably a step deeper. */}
      <AppSheet
        open={openStop !== null}
        onDismiss={() => setOpenStopId(null)}
        accessibilityLabel="Charger details"
        contentStyle={styles.detailContent}>
        {shownStop ? (
          <StopDetail
            // Keyed so the navigation-app picker and its error reset from one charger to the next.
            key={shownStop.siteId}
            stop={shownStop}
            index={shownStopIndex}
            planningRangeKm={plan?.vehicle.planningRangeKm ?? 0}
            dcPeakKw={plan?.vehicle.assumed.dcPeakKw ?? 0}
            live={!savedAt}
            onClose={() => setOpenStopId(null)}
          />
        ) : null}
      </AppSheet>

      {/* Above the sheet rather than inside it, so it is visible while a plan is still loading —
          which offline is exactly when it explains what is happening. */}
      <View style={styles.offlineWrap} pointerEvents="none">
        <OfflineBanner visible={isOffline} />
      </View>
    </ThemedView>
  );
}

/**
 * Says, unmistakably, that what follows is a remembered answer rather than a current one.
 *
 * Rendered above both the itinerary and the "not possible" verdict: a refusal restored from disk
 * is a claim about the world too, and stating it in the present tense with no date is the same
 * lie in the other direction.
 */
/** Green when the arrival honours the reserve, amber when it does not (only possible on old backends). */
function arrivalTone(arrivePct: number, reservePct: number | null, c: { text: string; tint: string; warning?: string }): string {
  if (reservePct == null) return c.text;
  return arrivePct + 0.5 >= reservePct ? c.tint : (c.warning ?? c.text);
}

function SavedPlanBanner({
  savedAt,
  drift,
  onRefresh,
}: {
  savedAt: string;
  /** Set when the car has been edited since, and the plan's margins are for the old figures. */
  drift?: string | null;
  onRefresh: () => void;
}) {
  const c = useThemeColors();
  return (
    <View style={[styles.savedBanner, { borderColor: c.warning, backgroundColor: c.surfaceSunken }]}>
      <MaterialIcons name="history" size={18} color={c.warning} />
      <View style={styles.savedBannerText}>
        <ThemedText style={[styles.savedBannerTitle, { color: c.text }]}>
          Saved plan from {formatSavedAt(savedAt)}
        </ThemedText>
        <ThemedText style={[styles.caption, { color: c.textMuted }]}>
          We could not reach the planner, so charger availability has not been checked since.
        </ThemedText>
        {drift ? (
          <ThemedText style={[styles.caption, { color: c.warning }]}>{drift}</ThemedText>
        ) : null}
      </View>
      <Pressable onPress={onRefresh} hitSlop={8} accessibilityLabel="Plan this trip again">
        <MaterialIcons name="refresh" size={22} color={c.tint} />
      </Pressable>
    </View>
  );
}

/**
 * One charger, opened from its pin or its card: what it is, and how to drive to it. Rendered
 * inside an `AppSheet` by the screen — this is only the card's content.
 *
 * The navigate action hands off to whatever map app the user already has, via the same
 * `getApps` whitelist the station sheet uses — we do not try to navigate in-app, and MapKit's
 * `lite` flavor could not route anyway.
 */
function StopDetail({
  stop,
  index,
  planningRangeKm,
  dcPeakKw,
  live,
  onClose,
}: {
  stop: PlanChargingStop;
  index: number;
  planningRangeKm: number;
  dcPeakKw: number;
  /** False when the plan was restored from disk, in which case occupancy is not shown at all. */
  live: boolean;
  onClose: () => void;
}) {
  const c = useThemeColors();
  const [apps, setApps] = useState<NavApp[]>([]);
  const [navError, setNavError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const rate = stopKmPerHour(stop, planningRangeKm);
  const power = effectivePowerKw(stop.gunKw, dcPeakKw);

  /**
   * Hand the coordinate to whatever map app the user has.
   *
   * `getApps` detects apps with `canOpenURL`, which on Android 11+ only sees packages declared in
   * the manifest's `<queries>` block — ours declares `https` only, so it reliably finds nothing
   * even on a phone with Google Maps installed. Rather than depend on that, we try the picker
   * first and fall back to firing a plain `geo:` intent, which needs no package visibility at all
   * because starting an intent is not the same as querying for one.
   */
  const openNav = async () => {
    setLoading(true);
    setNavError(null);
    try {
      const list = (await getApps({
        latitude: stop.lat,
        longitude: stop.lng,
        title: stop.name,
        alwaysIncludeGoogle: true,
        appsWhiteList: NAV_APPS_WHITELIST,
      }).catch(() => [])) as NavApp[];

      if (list.length > 1) {
        setApps(list);
        return;
      }
      if (list.length === 1) {
        await list[0].open();
        return;
      }

      // Parentheses would close the `geo:` label early; `encodeURIComponent` leaves them as-is.
      const label = encodeURIComponent(stop.name).replace(/[()]/g, (ch) => '%' + ch.charCodeAt(0).toString(16));
      const url =
        Platform.OS === 'ios'
          ? `http://maps.apple.com/?ll=${stop.lat},${stop.lng}&q=${label}`
          : `geo:${stop.lat},${stop.lng}?q=${stop.lat},${stop.lng}(${label})`;
      await Linking.openURL(url);
    } catch {
      setNavError('Could not open a navigation app.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <View style={styles.detailHeader}>
        <View style={[styles.pinSmall, { backgroundColor: c.tint }]}>
          <ThemedText style={[styles.pinText, { color: c.onAccent }]}>{index}</ThemedText>
        </View>
        <ThemedText style={styles.detailTitle} numberOfLines={2}>
          {stop.name}
        </ThemedText>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close charger details">
          <MaterialIcons name="close" size={22} color={c.textMuted} />
        </Pressable>
      </View>

      <ThemedText style={[styles.body, { color: c.text }]}>
        Arrive {Math.round(stop.arriveSocPct)}% · charge {formatDuration(stop.chargeMin)} · leave{' '}
        {Math.round(stop.departSocPct)}%
      </ThemedText>
      {power ? (
        <ThemedText style={[styles.caption, { color: c.textMuted }]}>
          {power.kw} kW{power.carLimited ? ' — your car’s limit' : ''}
          {rate ? `, adding about ${rate} km of range per hour here` : ''}
        </ThemedText>
      ) : null}
      <ThemedText style={[styles.caption, { color: c.textMuted }]}>
        {stop.progressKm.toFixed(0)} km into the trip
        {stop.lateralKm > 0.2 ? ` · ${stop.lateralKm.toFixed(1)} km off the route` : ''}
      </ThemedText>

      <View style={styles.chipRow}>
        {stop.gatekeeper ? <Tag tone="warn" text="Unavoidable stop" /> : null}
        {stop.powerConfidence === 'inferred' ? <Tag tone="muted" text="Power unconfirmed" /> : null}
        {live && stop.liveStatus === 'busy' ? <Tag tone="muted" text="Busy recently" /> : null}
      </View>

      {apps.length ? (
        <View style={styles.navList}>
          {apps.map((app) => (
            <Pressable
              key={app.id}
              onPress={() => void app.open()}
              accessibilityRole="button"
              style={[styles.navApp, { borderColor: c.border, backgroundColor: c.surface }]}>
              <ThemedText style={[styles.navAppText, { color: c.text }]}>{app.name}</ThemedText>
            </Pressable>
          ))}
        </View>
      ) : (
        <PrimaryButton
          label={loading ? 'Opening…' : 'Navigate to this charger'}
          onPress={() => void openNav()}
          disabled={loading}
          style={styles.buttonSpacing}
        />
      )}
      {navError ? (
        <ThemedText style={[styles.caption, { color: c.danger }]}>{navError}</ThemedText>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  /** Fixed header + scrolling list, filling whatever detent the sheet is at. */
  sheetBody: { flex: 1 },
  sheetScroll: { flex: 1 },
  sheetHeader: { paddingHorizontal: SHEET_PADDING_H, paddingTop: 4, paddingBottom: 12, gap: 12 },
  sheetContent: { paddingHorizontal: SHEET_PADDING_H, paddingTop: 4, gap: 12 },
  centered: { alignItems: 'center', gap: 10, padding: 24 },
  headlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headline: { fontSize: 17, fontWeight: '700' },
  summaryRow: { gap: 4 },
  bigTime: { fontSize: 30, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20 },
  caption: { fontSize: 13, lineHeight: 18 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  savedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  savedBannerText: { flex: 1, gap: 2 },
  savedBannerTitle: { fontSize: 14, fontWeight: '700' },
  offlineWrap: { position: 'absolute', top: 10, left: 12, right: 12 },
  buttonSpacing: { marginTop: 6, alignSelf: 'stretch' },
  detailContent: { gap: 10, paddingTop: 8 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailTitle: { flex: 1, fontSize: 17, fontWeight: '700' },
  pinSmall: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  navList: { gap: 8 },
  navApp: {
    height: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navAppText: { fontSize: 15, fontWeight: '700' },
  pin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinText: { fontSize: 14, fontWeight: '800' },
  endPin: { width: 18, height: 18, borderRadius: 9, borderWidth: 3 },
  stopCard: { padding: 16, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, gap: 8 },
  stopHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stopIndex: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stopIndexText: { fontSize: 13, fontWeight: '800' },
  arrivalRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: 2 },
  stopName: { flex: 1, fontSize: 15, fontWeight: '700' },
  whyCard: { padding: 16, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
});
