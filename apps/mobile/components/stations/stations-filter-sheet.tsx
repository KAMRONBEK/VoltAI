import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { StationsFilters } from '@/types/stationsFilters';
import { DEFAULT_STATIONS_FILTERS } from '@/types/stationsFilters';

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
  const colorScheme = useColorScheme() ?? 'dark';
  const sheetRef = useRef<BottomSheet | null>(null);
  const snapPoints = useMemo(() => [260, '75%'], []);

  useEffect(() => {
    if (open) {
      sheetRef.current?.snapToIndex(1);
    } else {
      sheetRef.current?.close();
    }
  }, [open]);

  const text = Colors[colorScheme].text;

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={onClose}
      backgroundStyle={[styles.sheetBackground, { backgroundColor: Colors[colorScheme].background }]}
      handleIndicatorStyle={{ backgroundColor: 'rgba(255,255,255,0.25)' }}>
      <BottomSheetScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <ThemedText type="subtitle">Filters</ThemedText>
          <Pressable onPress={onReset} accessibilityRole="button">
            <ThemedText type="defaultSemiBold" style={{ color: Colors[colorScheme].tint }}>
              Reset
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.row}>
          <ThemedText type="defaultSemiBold">Only available</ThemedText>
          <Switch
            value={filters.onlyAvailable}
            onValueChange={(v) => onChange({ ...filters, onlyAvailable: v })}
          />
        </View>

        <View style={styles.section}>
          <ThemedText type="defaultSemiBold">Min power (kW)</ThemedText>
          <TextInput
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
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={[styles.input, { color: text }]}
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

        <Pressable style={[styles.closeButton, { backgroundColor: Colors[colorScheme].tint }]} onPress={onClose}>
          <ThemedText style={styles.closeText}>Apply</ThemedText>
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
  const colorScheme = useColorScheme() ?? 'dark';

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
                isOn ? { borderColor: `${Colors[colorScheme].tint}99` } : null,
                isOn ? { backgroundColor: `${Colors[colorScheme].tint}1A` } : null,
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
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
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
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  closeButton: {
    marginTop: 8,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: '#0b0b0b',
    fontWeight: '800',
  },
});

