import BottomSheet, { BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { CATEGORIES } from '@/lib/categories';
import { useThemeColors } from '@/lib/theme/theme-context';
import type { ChargerCategory } from '@/types/stations';
import type { StationsFilters } from '@/types/stationsFilters';
import { DEFAULT_STATIONS_FILTERS } from '@/types/stationsFilters';

const CATEGORY_ORDER: ChargerCategory[] = ['ultra', 'dc', 'hybrid', 'ac'];

type FilterOptions = {
  connectorTypes: string[];
  operators: string[];
  cities: string[];
  amenities: string[];
};

type Props = {
  open: boolean;
  filters: StationsFilters;
  options: FilterOptions;
  onClose: () => void;
  onChange: (next: StationsFilters) => void;
  onReset: () => void;
};

function toggleInArray(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
}

export function StationsFilterSheet({ open, filters, options, onClose, onChange, onReset }: Props) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheet | null>(null);
  const snapPoints = useMemo(() => [260, '75%'], []);

  useEffect(() => {
    if (open) {
      sheetRef.current?.snapToIndex(1);
    } else {
      sheetRef.current?.close();
    }
  }, [open]);

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      keyboardBehavior="interactive"
      android_keyboardInputMode="adjustResize"
      onClose={onClose}
      backgroundStyle={[styles.sheetBackground, { backgroundColor: c.background }]}
      handleIndicatorStyle={{ backgroundColor: c.handle }}>
      <BottomSheetScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 88 }]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <ThemedText type="subtitle">Filters</ThemedText>
          <Pressable onPress={onReset} accessibilityRole="button">
            <ThemedText type="defaultSemiBold" style={{ color: c.tint }}>
              Reset
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.row}>
          <ThemedText type="defaultSemiBold">Only available</ThemedText>
          <Switch
            value={filters.onlyAvailable}
            onValueChange={(v) => onChange({ ...filters, onlyAvailable: v })}
            trackColor={{ true: c.tint }}
          />
        </View>

        <View style={styles.section}>
          <ThemedText type="defaultSemiBold">Charger type</ThemedText>
          <View style={styles.pillsRow}>
            {CATEGORY_ORDER.map((id) => {
              const cat = CATEGORIES[id];
              const isOn = filters.categories.includes(id);
              return (
                <Pressable
                  key={id}
                  onPress={() =>
                    onChange({
                      ...filters,
                      categories: isOn
                        ? filters.categories.filter((c) => c !== id)
                        : [...filters.categories, id],
                    })
                  }
                  style={[
                    styles.pill,
                    styles.catPill,
                    { backgroundColor: c.surface, borderColor: isOn ? cat.color : c.border },
                    isOn ? { backgroundColor: `${cat.color}26` } : null,
                  ]}
                  accessibilityRole="button">
                  <View style={[styles.catRing, { borderColor: cat.color, backgroundColor: c.surface }]} />
                  <ThemedText type="defaultSemiBold">{cat.label}</ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText type="defaultSemiBold">Min power (kW)</ThemedText>
          <BottomSheetTextInput
            value={filters.minPowerKw === null ? '' : String(filters.minPowerKw)}
            onChangeText={(t) => {
              if (!t.trim().length) {
                onChange({ ...filters, minPowerKw: null });
                return;
              }
              const n = Number(t.replace(/[^\d]/g, ''));
              onChange({ ...filters, minPowerKw: Number.isFinite(n) ? Math.max(0, Math.round(n)) : null });
            }}
            keyboardType="number-pad"
            placeholder={DEFAULT_STATIONS_FILTERS.minPowerKw === null ? 'Any' : String(DEFAULT_STATIONS_FILTERS.minPowerKw)}
            placeholderTextColor={c.placeholder}
            style={[styles.input, { backgroundColor: c.inputBg, borderColor: c.border, color: c.text }]}
          />
        </View>

        <PillsSection
          title="Connector types"
          values={options.connectorTypes}
          selected={filters.connectorTypes}
          onToggle={(v) => onChange({ ...filters, connectorTypes: toggleInArray(filters.connectorTypes, v) })}
        />
        <PillsSection
          title="Operator"
          values={options.operators}
          selected={filters.operators}
          onToggle={(v) => onChange({ ...filters, operators: toggleInArray(filters.operators, v) })}
        />
        <PillsSection
          title="City"
          values={options.cities}
          selected={filters.cities}
          onToggle={(v) => onChange({ ...filters, cities: toggleInArray(filters.cities, v) })}
        />
        <PillsSection
          title="Amenities"
          values={options.amenities}
          selected={filters.amenities}
          onToggle={(v) => onChange({ ...filters, amenities: toggleInArray(filters.amenities, v) })}
        />

        <Pressable style={[styles.closeButton, { backgroundColor: c.accent }]} onPress={onClose}>
          <ThemedText style={[styles.closeText, { color: c.onAccent }]}>Apply</ThemedText>
        </Pressable>
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

function PillsSection({
  title,
  values,
  selected,
  onToggle,
}: {
  title: string;
  values: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  const c = useThemeColors();

  if (!values.length) return null;

  return (
    <View style={styles.section}>
      <ThemedText type="defaultSemiBold">{title}</ThemedText>
      <View style={styles.pillsRow}>
        {values.map((v) => {
          const isOn = selected.includes(v);
          return (
            <Pressable
              key={v}
              onPress={() => onToggle(v)}
              style={[
                styles.pill,
                { backgroundColor: c.surface, borderColor: c.border },
                isOn ? { borderColor: `${c.tint}99` } : null,
                isOn ? { backgroundColor: `${c.tint}1A` } : null,
              ]}
              accessibilityRole="button">
              <ThemedText type="defaultSemiBold">{v}</ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  section: {
    gap: 10,
  },
  input: {
    height: 46,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1.5,
  },
  catRing: {
    width: 13,
    height: 13,
    borderRadius: 5,
    borderWidth: 3,
  },
  closeButton: {
    marginTop: 8,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontWeight: '800',
  },
});
