import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack, router } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { EmptyState } from '@/components/ui/empty-state';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Tag } from '@/components/ui/tag';
import { useThemeColors } from '@/lib/theme/theme-context';
import { useAtomValue, useSetAtom } from 'jotai';
import { PLUG_OPTIONS, derivedSpec, type SavedCar } from '@/lib/vehicles/garage';
import {
  carsAtom,
  garageLoadedAtom,
  removeCarAtom,
  selectCarAtom,
  selectedCarAtom,
} from '@/lib/vehicles/garage-atoms';

/** Saved cars: pick the default, edit, delete. */
export default function GarageScreen() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const cars = useAtomValue(carsAtom);
  const selectedCar = useAtomValue(selectedCarAtom);
  const isLoaded = useAtomValue(garageLoadedAtom);
  const removeCar = useSetAtom(removeCarAtom);
  const selectCar = useSetAtom(selectCarAtom);

  const confirmRemove = (car: SavedCar) => {
    Alert.alert('Remove car', `Remove ${car.label || 'this car'} from your garage?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeCar(car.id) },
    ]);
  };

  return (
    <ThemedView style={styles.root}>
      <Stack.Screen options={{ title: 'Your cars', headerShown: true }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled">
        {!isLoaded ? null : cars.length === 0 ? (
          <EmptyState
            icon="directions-car"
            title="No cars yet"
            body="Add your car once and trip planning knows how far it goes and which chargers fit it."
          />
        ) : (
          cars.map((car) => {
            const spec = derivedSpec(car);
            const isSelected = selectedCar?.id === car.id;
            const plugLabel = PLUG_OPTIONS.find((p) => p.value === car.plug)?.label;
            return (
              <Pressable
                key={car.id}
                onPress={() => selectCar(car.id)}
                style={[
                  styles.card,
                  {
                    backgroundColor: c.surface,
                    borderColor: isSelected ? c.tint : c.border,
                    borderWidth: isSelected ? 1.5 : StyleSheet.hairlineWidth,
                  },
                ]}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardTitleWrap}>
                    <ThemedText style={styles.cardTitle}>{car.label || 'Unnamed car'}</ThemedText>
                    <ThemedText style={[styles.caption, { color: c.textMuted }]}>
                      {spec.realRangeKm} km real range · about {spec.packKwh} kWh · up to{' '}
                      {spec.dcPeakKw} kW
                    </ThemedText>
                  </View>
                  {isSelected ? (
                    <MaterialIcons name="check-circle" size={22} color={c.tint} />
                  ) : null}
                </View>

                {car.plug ? (
                  <Tag text={`${plugLabel} connector`} />
                ) : (
                  // Without a connector we cannot tell which chargers physically fit, so the car
                  // is unusable for planning until this is answered. Said plainly, not hidden.
                  <Pressable onPress={() => router.push(`/garage/${car.id}`)}>
                    <Tag
                      tone="danger"
                      text="Connector needed before this car can be planned with"
                      leading={<MaterialIcons name="error-outline" size={14} color={c.danger} />}
                    />
                  </Pressable>
                )}

                <View style={styles.cardActions}>
                  <Pressable
                    onPress={() => router.push(`/garage/${car.id}`)}
                    style={[styles.smallButton, { borderColor: c.border }]}>
                    <ThemedText style={[styles.smallButtonText, { color: c.text }]}>Edit</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmRemove(car)}
                    style={[styles.smallButton, { borderColor: c.border }]}>
                    <ThemedText style={[styles.smallButtonText, { color: c.danger }]}>Remove</ThemedText>
                  </Pressable>
                </View>
              </Pressable>
            );
          })
        )}

        <PrimaryButton label="Add a car" onPress={() => router.push('/garage/new')} />

        <ThemedText style={[styles.caption, { color: c.textMuted, textAlign: 'center' }]}>
          Saved on this device — no account. When you plan a trip, only the car figures the planner
          needs (range, connector, charging speed) go to the server, never a name or an identity.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 14 },
  card: { padding: 16, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitleWrap: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  caption: { fontSize: 13, lineHeight: 18 },
  cardActions: { flexDirection: 'row', gap: 10 },
  smallButton: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButtonText: { fontSize: 14, fontWeight: '700' },
});
