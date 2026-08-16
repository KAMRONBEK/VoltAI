import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import * as Location from 'expo-location';
import { Stack, router } from 'expo-router';
import { YandexMapView, type YandexMapViewRef } from 'expo-yandex-mapkit';
import { useAtom, useAtomValue } from 'jotai';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SHEET_PADDING_H, useSheetChrome } from '@/components/ui/app-sheet';
import { PrimaryButton } from '@/components/ui/primary-button';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  coordToPoint,
  destPointAtom,
  originPointAtom,
  pickTargetAtom,
} from '@/lib/plan/tripPoints';
import { useThemeColors } from '@/lib/theme/theme-context';

/**
 * Drop a pin for one end of the trip.
 *
 * A fixed crosshair over a movable map, rather than tap-to-place: the crosshair is always at the
 * screen centre so it is never under the user's thumb, and panning to fine-tune is more precise
 * than repeatedly tapping. The camera centre IS the answer, which is why it is tracked from
 * `onCameraPositionChanged` rather than read once on confirm.
 */
export default function PickPointScreen() {
  const c = useThemeColors();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const chrome = useSheetChrome();
  const mapRef = useRef<YandexMapViewRef | null>(null);

  const target = useAtomValue(pickTargetAtom);
  const [origin, setOrigin] = useAtom(originPointAtom);
  const [destination, setDestination] = useAtom(destPointAtom);

  const existing = target === 'from' ? origin : destination;

  /**
   * Where the camera should be *put*, as distinct from where it currently is.
   *
   * Only ever assigned programmatically — the initial framing and the my-location jump. It is
   * deliberately NOT updated from `onCameraPositionChanged`: feeding the live camera back into
   * the prop that drives the camera makes every drag frame re-apply a position one frame behind
   * the finger, so the map fights the gesture and visibly judders back and forth.
   */
  const [camera, setCamera] = useState({
    latitude: existing?.lat ?? 41.311081,
    longitude: existing?.lng ?? 69.240562,
    zoom: 11,
  });

  const initialCenter = { latitude: camera.latitude, longitude: camera.longitude };
  /** Where the camera actually is. A ref, so panning re-renders nothing at all. */
  const centerRef = useRef(initialCenter);
  /** The same value, mirrored into state only when a gesture settles, purely for the readout. */
  const [readout, setReadout] = useState(initialCenter);

  // Start over the user's own location when picking an origin they have not set yet — that is
  // almost always what "from" means.
  useEffect(() => {
    if (target !== 'from' || existing) return;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const pos = await Location.getLastKnownPositionAsync();
        if (!pos || cancelled) return;
        // The camera follows the `cameraPosition` prop, so assigning it moves the map — there is
        // no imperative camera setter on the ref. This is a programmatic move, which is the only
        // kind allowed to touch `camera`.
        const next = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        centerRef.current = next;
        setReadout(next);
        setCamera((prev) => ({ ...prev, ...next }));
      } catch {
        // Location is a convenience here, never a requirement.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const confirm = () => {
    // From the ref, not the readout: the ref is current even if the user confirms mid-gesture.
    const point = coordToPoint(centerRef.current.latitude, centerRef.current.longitude);
    if (target === 'from') setOrigin(point);
    else setDestination(point);
    router.back();
  };

  return (
    <ThemedView style={styles.root}>
      <Stack.Screen
        options={{ title: target === 'from' ? 'Starting point' : 'Destination', headerShown: true }}
      />

      <YandexMapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        animated={false}
        nightMode={colorScheme === 'dark'}
        showUserPosition
        cameraPosition={camera}
        onCameraPositionChanged={(e) => {
          const p = e.nativeEvent.cameraPosition;
          if (typeof p?.latitude !== 'number' || typeof p?.longitude !== 'number') return;
          centerRef.current = { latitude: p.latitude, longitude: p.longitude };
          // Only once the gesture settles. Mirroring every frame into state would re-render the
          // panel ~60×/s to update a coordinate nobody can read while the map is still moving.
          if (e.nativeEvent.finished) setReadout(centerRef.current);
        }}
      />

      {/* The crosshair is a non-interactive overlay pinned to the exact screen centre, so what the
          user sees under it is precisely what `center` holds. */}
      <View pointerEvents="none" style={styles.crosshairWrap}>
        <View style={[styles.crosshairRing, { borderColor: c.tint }]} />
        <View style={[styles.crosshairDot, { backgroundColor: c.tint }]} />
        <View style={[styles.crosshairStem, { backgroundColor: c.tint }]} />
      </View>

      {/* The confirm tray: a content-sized sheet that cannot be swiped away — the same chrome as
          every other panel in the app, over a map that stays live underneath. */}
      <BottomSheet
        enableDynamicSizing
        enablePanDownToClose={false}
        enableOverDrag={false}
        accessibilityLabel="Confirm the pin"
        {...chrome}>
        <BottomSheetView style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
          <ThemedText style={[styles.hint, { color: c.textMuted }]}>
            Drag the map to place the pin, then confirm.
          </ThemedText>
          <View style={[styles.coordBox, { backgroundColor: c.surface, borderColor: c.border }]}>
            <MaterialIcons name="place" size={18} color={c.tint} />
            <ThemedText style={[styles.coordText, { color: c.text }]}>
              {readout.latitude.toFixed(5)}, {readout.longitude.toFixed(5)}
            </ThemedText>
          </View>
          <PrimaryButton
            label={`Use this ${target === 'from' ? 'starting point' : 'destination'}`}
            onPress={confirm}
          />
        </BottomSheetView>
      </BottomSheet>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  crosshairWrap: {
    ...StyleSheet.absoluteFill as object,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairRing: { width: 26, height: 26, borderRadius: 13, borderWidth: 3 },
  crosshairDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3 },
  // A short stem below the ring so the pin reads as standing on the point, not floating over it.
  crosshairStem: { position: 'absolute', top: '50%', marginTop: 13, width: 2, height: 14 },
  panel: {
    paddingTop: 4,
    paddingHorizontal: SHEET_PADDING_H,
    gap: 12,
  },
  hint: { fontSize: 13, lineHeight: 18 },
  coordBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 46,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  coordText: { fontSize: 15, fontWeight: '600' },
});
