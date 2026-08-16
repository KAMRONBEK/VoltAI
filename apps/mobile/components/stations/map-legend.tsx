import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { ThemedText } from '@/components/themed-text';
import { AppSheet } from '@/components/ui/app-sheet';
import { StatusDot } from '@/components/ui/status-dot';
import { CATEGORIES } from '@/lib/categories';
import type { Station } from '@/types/stations';
import { useThemeColors } from '@/lib/theme/theme-context';

const ITEMS = [CATEGORIES.ultra, CATEGORIES.dc, CATEGORIES.hybrid, CATEGORIES.ac];
const STATUS: { status: Station['status']; label: string }[] = [
  { status: 'available', label: 'Free' },
  { status: 'in_use', label: 'In use' },
  { status: 'offline', label: 'Offline' },
];

/**
 * Map legend: a "Legend" chrome button on the map that opens a sheet explaining the pins — the
 * ring colour = charger category, the dots = each charger's status. A sheet rather than an
 * in-place card, so it reads the same as every other panel in the app and never covers the map
 * controls it sits beside.
 */
export function MapLegend() {
  const c = useThemeColors();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        style={[styles.fab, { backgroundColor: c.chrome, borderColor: c.chromeBorder, boxShadow: c.chromeShadow }]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Map legend"
      >
        <MaterialIcons name="info-outline" size={18} color={c.chromeIcon} />
        <ThemedText style={[styles.fabText, { color: c.chromeText }]}>Legend</ThemedText>
      </Pressable>

      <AppSheet open={open} onDismiss={() => setOpen(false)} accessibilityLabel="Map legend" contentStyle={styles.content}>
        <ThemedText type="subtitle">Reading the map</ThemedText>

        <View style={styles.block}>
          <ThemedText style={[styles.heading, { color: c.textMuted }]}>Ring = charger type</ThemedText>
          <View style={styles.rows}>
            {ITEMS.map((cat) => (
              <View key={cat.id} style={styles.item}>
                <View style={[styles.ring, { borderColor: cat.color, backgroundColor: c.surface }]} />
                <ThemedText style={styles.label}>{cat.label}</ThemedText>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.block}>
          <ThemedText style={[styles.heading, { color: c.textMuted }]}>Dots = each charger</ThemedText>
          <View style={styles.rows}>
            {STATUS.map((s) => (
              <View key={s.label} style={styles.item}>
                <StatusDot status={s.status} />
                <ThemedText style={styles.label}>{s.label}</ThemedText>
              </View>
            ))}
          </View>
        </View>

        <ThemedText style={[styles.hint, { color: c.textMuted }]}>
          Several chargers at one address share a pin: one dot per charger, the operator’s logo in
          the middle.
        </ThemedText>
      </AppSheet>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fabText: { fontSize: 13, fontWeight: '700' },
  content: { gap: 16, paddingTop: 10 },
  block: { gap: 10 },
  heading: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  rows: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ring: { width: 16, height: 16, borderRadius: 6, borderWidth: 3 },
  label: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 13, lineHeight: 18 },
});
