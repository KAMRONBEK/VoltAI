import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { ThemedText } from '@/components/themed-text';
import { CATEGORIES } from '@/lib/categories';

const ITEMS = [CATEGORIES.ultra, CATEGORIES.dc, CATEGORIES.hybrid, CATEGORIES.ac];
const STATUS = [
  { c: '#2FE28A', l: 'Free' },
  { c: '#F7B84B', l: 'In use' },
  { c: '#8A9099', l: 'Offline' },
];

/** Collapsible map legend: the ring color = charger category, the dots = each charger's status. */
export function MapLegend() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Pressable style={styles.fab} onPress={() => setOpen(true)} accessibilityLabel="Map legend">
        <MaterialIcons name="info-outline" size={18} color="#ECEDEE" />
        <ThemedText style={styles.fabText}>Legend</ThemedText>
      </Pressable>
    );
  }

  return (
    <Pressable style={styles.card} onPress={() => setOpen(false)}>
      <ThemedText style={styles.heading}>Ring = charger type</ThemedText>
      <View style={styles.row}>
        {ITEMS.map((c) => (
          <View key={c.id} style={styles.item}>
            <View style={[styles.ring, { borderColor: c.color }]} />
            <ThemedText style={styles.label}>{c.label}</ThemedText>
          </View>
        ))}
      </View>
      <ThemedText style={[styles.heading, styles.heading2]}>Dots = each charger</ThemedText>
      <View style={styles.row}>
        {STATUS.map((s) => (
          <View key={s.l} style={styles.item}>
            <View style={[styles.dot, { backgroundColor: s.c }]} />
            <ThemedText style={styles.label}>{s.l}</ThemedText>
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
    backgroundColor: 'rgba(18,18,18,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  fabText: { fontSize: 13, fontWeight: '700' },
  card: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(18,18,18,0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    gap: 8,
  },
  heading: { fontSize: 11, fontWeight: '800', opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 },
  heading2: { marginTop: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ring: { width: 14, height: 14, borderRadius: 5, borderWidth: 3, backgroundColor: '#fff' },
  dot: { width: 10, height: 10, borderRadius: 999 },
  label: { fontSize: 12, fontWeight: '600' },
});
