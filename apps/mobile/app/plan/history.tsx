import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack, router } from 'expo-router';
import { useAtomValue, useSetAtom } from 'jotai';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ConfirmSheet } from '@/components/ui/dialog-sheet';
import { EmptyState } from '@/components/ui/empty-state';
import { deleteTripAtom, savedTripsAtom } from '@/lib/plan/plan-history-atoms';
import { formatDuration } from '@/lib/plan/planClient';
import { formatSavedAt, type SavedTrip } from '@/lib/plan/planHistory';
import { useThemeColors } from '@/lib/theme/theme-context';

/**
 * Trips planned earlier.
 *
 * Opening one replays its original parameters, so it re-plans against current charger data when
 * there is a connection and falls back to the stored copy when there is not. It deliberately does
 * not open the saved plan directly: a trip you are about to drive should use today's answer if
 * today's answer is available.
 */
export default function PlanHistoryScreen() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const trips = useAtomValue(savedTripsAtom);
  const removeTrip = useSetAtom(deleteTripAtom);
  /** The trip whose "Forget?" sheet is open. */
  const [pendingDelete, setPendingDelete] = useState<SavedTrip | null>(null);

  return (
    <ThemedView style={styles.root}>
      <Stack.Screen options={{ title: 'Saved trips', headerShown: true }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {trips.length === 0 ? (
          <EmptyState
            icon="alt-route"
            title="No saved trips yet"
            body="Every trip you plan is kept here with its route, so you can open it again where there is no signal."
          />
        ) : (
          <>
            <ThemedText style={[styles.caption, { color: c.textMuted }]}>
              Kept on this phone, route included, so a trip already under way survives losing
              signal.
            </ThemedText>
            {trips.map((trip) => (
              <View
                key={trip.id}
                style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Pressable
                  style={styles.cardMain}
                  onPress={() => router.push({ pathname: '/plan/results', params: trip.params })}>
                  <ThemedText style={styles.route} numberOfLines={1}>
                    {trip.params.fromLabel} → {trip.params.toLabel}
                  </ThemedText>
                  <ThemedText style={[styles.caption, { color: c.textMuted }]}>
                    {trip.feasible && trip.totalMin != null
                      ? `${formatDuration(trip.totalMin)} · ${Math.round(trip.distanceKm)} km · ${
                          trip.stops ?? 0
                        } ${trip.stops === 1 ? 'stop' : 'stops'}`
                      : `${Math.round(trip.distanceKm)} km · not possible with this car`}
                  </ThemedText>
                  <ThemedText style={[styles.caption, { color: c.textMuted }]}>
                    {trip.carLabel || 'Unnamed car'} · saved {formatSavedAt(trip.savedAt)}
                  </ThemedText>
                </Pressable>
                <Pressable onPress={() => setPendingDelete(trip)} hitSlop={10} style={styles.delete}>
                  <MaterialIcons name="delete-outline" size={22} color={c.textMuted} />
                </Pressable>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <ConfirmSheet
        open={pendingDelete !== null}
        onDismiss={() => setPendingDelete(null)}
        title="Forget this trip?"
        body={
          pendingDelete
            ? `${pendingDelete.params.fromLabel} → ${pendingDelete.params.toLabel} will no longer be available offline.`
            : undefined
        }
        icon="delete-outline"
        confirmLabel="Forget"
        cancelLabel="Keep"
        destructive
        onConfirm={() => {
          if (pendingDelete) void removeTrip(pendingDelete.id);
        }}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 12 },
  caption: { fontSize: 13, lineHeight: 18 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardMain: { flex: 1, padding: 16, gap: 4 },
  route: { fontSize: 15, fontWeight: '700' },
  delete: { padding: 16 },
});
