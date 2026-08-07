import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { ThemedText } from '@/components/themed-text';
import { CATEGORIES } from '@/lib/categories';
import { useThemeColors } from '@/lib/theme/theme-context';

const ITEMS = [CATEGORIES.ultra, CATEGORIES.dc, CATEGORIES.hybrid, CATEGORIES.ac];
const STATUS = [
  { c: '#2FE28A', l: 'Free' },
  { c: '#F7B84B', l: 'In use' },
  { c: '#8A9099', l: 'Offline' },
];

/** Collapsible map legend: the ring color = charger category, the dots = each charger's status. */
export function MapLegend() {
  const c = useThemeColors();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Pressable
        style={[styles.fab, { backgroundColor: c.chrome, borderColor: c.chromeBorder }]}
        onPress={() => setOpen(true)}
        accessibilityLabel="Map legend"
      >
        <MaterialIcons name="info-outline" size={18} color={c.chromeIcon} />
        <ThemedText style={[styles.fabText, { color: c.chromeText }]}>Legend</ThemedText>
      </Pressable>
    );
  }

  return (
    <Pressable
      style={[styles.card, { backgroundColor: c.chrome, borderColor: c.chromeBorder }]}
      onPress={() => setOpen(false)}
    >
      <ThemedText style={[styles.heading, { color: c.chromeText }]}>Ring = charger type</ThemedText>
      <View style={styles.row}>
        {ITEMS.map((cat) => (
          <View key={cat.id} style={styles.item}>
            <View style={[styles.ring, { borderColor: cat.color, backgroundColor: c.chrome }]} />
            <ThemedText style={[styles.label, { color: c.chromeText }]}>{cat.label}</ThemedText>
          </View>
        ))}
      </View>
      <ThemedText style={[styles.heading, styles.heading2, { color: c.chromeText }]}>
        Dots = each charger
      </ThemedText>
      <View style={styles.row}>
        {STATUS.map((s) => (
          <View key={s.l} style={styles.item}>
            <View style={[styles.dot, { backgroundColor: s.c }]} />
            <ThemedText style={[styles.label, { color: c.chromeText }]}>{s.l}</ThemedText>
          </View>
        ))}
      </View>
    </Pressable>
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
  card: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  heading: { fontSize: 11, fontWeight: '800', opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 },
  heading2: { marginTop: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ring: { width: 14, height: 14, borderRadius: 5, borderWidth: 3 },
  dot: { width: 10, height: 10, borderRadius: 999 },
  label: { fontSize: 12, fontWeight: '600' },
});
