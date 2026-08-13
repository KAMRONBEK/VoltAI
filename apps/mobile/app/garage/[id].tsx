import { Stack, router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Section } from '@/components/ui/section';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useThemeColors } from '@/lib/theme/theme-context';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  CURVE_OPTIONS,
  DEFAULT_CONS_WH_KM,
  DEFAULT_DC_PEAK_KW,
  PLUG_OPTIONS,
  STICKER_TO_REAL,
  blankCar,
  derivedSpec,
  type CurvePreset,
  type Plug,
  type RangeSource,
} from '@/lib/vehicles/garage';
import { addCarAtom, carByIdAtom, updateCarAtom } from '@/lib/vehicles/garage-atoms';

/** Add or edit one car. `id === 'new'` creates. */
export default function CarEditScreen() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const getCar = useAtomValue(carByIdAtom);
  const addCar = useSetAtom(addCarAtom);
  const updateCar = useSetAtom(updateCarAtom);

  const isNew = id === 'new';
  const existing = isNew ? null : getCar(String(id));
  const base = useMemo(() => existing ?? blankCar(), [existing]);

  const [label, setLabel] = useState(base.label);
  const [rangeText, setRangeText] = useState(base.rangeKm ? String(base.rangeKm) : '');
  const [rangeSource, setRangeSource] = useState<RangeSource>(base.rangeSource);
  const [plug, setPlug] = useState<Plug | null>(base.plug);
  const [curve, setCurve] = useState<CurvePreset>(base.curvePreset);
  const [dcKwText, setDcKwText] = useState(String(base.dcPeakKw));
  const [consText, setConsText] = useState(String(base.consWhKm));
  const [showAdvanced, setShowAdvanced] = useState(false);

  const rangeKm = Number(rangeText) || 0;
  const dcPeakKw = Number(dcKwText) || DEFAULT_DC_PEAK_KW;
  const consWhKm = Number(consText) || DEFAULT_CONS_WH_KM;

  // A plug-in hybrid's advertised "range" is mostly petrol, so deriving a battery from it produces
  // a fictitious pack and a plan with no charging stops at all.
  const looksLikeHybrid = /chazor|dm-?i|phev|plug-?in hybrid/i.test(label);
  const rangeImplausible = rangeKm > 700;

  const spec = derivedSpec({ rangeKm, rangeSource, consWhKm, dcPeakKw });

  const problem = !label.trim()
    ? 'Give the car a name'
    : rangeKm < 50
      ? 'Enter the range in km'
      : looksLikeHybrid
        ? 'This looks like a plug-in hybrid — only fully electric cars can be planned'
        : rangeImplausible
          ? 'That range looks like a spec-sheet figure — switch to “Spec sheet” below'
          : !plug
            ? 'Choose the connector your car uses'
            : null;

  const onSave = () => {
    if (problem || !plug) return;
    const now = new Date().toISOString();
    const car = {
      ...base,
      label: label.trim(),
      rangeKm,
      rangeSource,
      plug,
      dcPeakKw,
      consWhKm,
      curvePreset: curve,
      updatedAt: now,
    };
    if (isNew) addCar(car);
    else updateCar(car);
    router.back();
  };

  return (
    <ThemedView style={styles.root}>
      <Stack.Screen options={{ title: isNew ? 'Add a car' : 'Edit car', headerShown: true }} />
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled">
          <Section title="Car">
            <Field label="Name">
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder="BYD Song Plus"
                placeholderTextColor={c.placeholder}
                autoCapitalize="words"
                style={[styles.input, { backgroundColor: c.inputBg, color: c.text, borderColor: c.border }]}
              />
            </Field>

            <Field label="Range at 100% (km)">
              <TextInput
                value={rangeText}
                onChangeText={(t) => setRangeText(t.replace(/[^\d]/g, ''))}
                placeholder="400"
                placeholderTextColor={c.placeholder}
                keyboardType="number-pad"
                style={[styles.input, { backgroundColor: c.inputBg, color: c.text, borderColor: c.border }]}
              />
            </Field>

            <SegmentedControl
              options={[
                { value: 'observed' as RangeSource, label: 'What I actually get' },
                { value: 'sticker' as RangeSource, label: 'Spec sheet' },
              ]}
              value={rangeSource}
              onChange={setRangeSource}
            />
            <ThemedText style={[styles.caption, { color: c.textMuted }]}>
              {rangeSource === 'sticker'
                ? `Spec-sheet figures run optimistic, so we plan with about ${Math.round(
                    STICKER_TO_REAL * 100
                  )}% of it — ${spec.realRangeKm} km.`
                : 'Best answer is what you see in mild weather on a long drive.'}
            </ThemedText>
          </Section>

          {/* No default selection and no "most people pick this" shortcut. The GB/T and CCS2
              networks here barely overlap, so a wrong guess sends the driver to sockets that do
              not fit — which is a stranding bug, not a preference. */}
          <Section title="Connector — required">
            <ThemedText style={[styles.caption, { color: c.textMuted }]}>
              This decides which chargers physically fit your car. We will not guess it.
            </ThemedText>
            {PLUG_OPTIONS.map((option) => {
              const active = plug === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setPlug(option.value)}
                  style={[
                    styles.optionRow,
                    {
                      backgroundColor: active ? c.surfaceSunken : 'transparent',
                      borderColor: active ? c.tint : c.border,
                    },
                  ]}>
                  <View style={styles.optionText}>
                    <ThemedText style={styles.optionLabel}>{option.label}</ThemedText>
                    <ThemedText style={[styles.caption, { color: c.textMuted }]}>{option.hint}</ThemedText>
                  </View>
                  <View
                    style={[
                      styles.radio,
                      { borderColor: active ? c.tint : c.border, backgroundColor: active ? c.tint : 'transparent' },
                    ]}
                  />
                </Pressable>
              );
            })}
          </Section>

          <Section title="Charging">
            <ThemedText style={[styles.caption, { color: c.textMuted }]}>
              How quickly the battery slows down as it fills. Pick Standard if unsure.
            </ThemedText>
            <SegmentedControl
              options={CURVE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              value={curve}
              onChange={setCurve}
            />
            <ThemedText style={[styles.caption, { color: c.textMuted }]}>
              {CURVE_OPTIONS.find((o) => o.value === curve)?.hint}
            </ThemedText>
          </Section>

          <Pressable onPress={() => setShowAdvanced((v) => !v)} style={styles.advancedToggle}>
            <ThemedText style={[styles.advancedText, { color: c.tint }]}>
              {showAdvanced ? 'Hide details' : 'More details'}
            </ThemedText>
          </Pressable>

          {showAdvanced ? (
            <Section title="Details">
              <Field label="Fastest charging speed the car accepts (kW)">
                <TextInput
                  value={dcKwText}
                  onChangeText={(t) => setDcKwText(t.replace(/[^\d]/g, ''))}
                  keyboardType="number-pad"
                  style={[styles.input, { backgroundColor: c.inputBg, color: c.text, borderColor: c.border }]}
                />
              </Field>
              <Field label="Energy use (Wh per km)">
                <TextInput
                  value={consText}
                  onChangeText={(t) => setConsText(t.replace(/[^\d]/g, ''))}
                  keyboardType="number-pad"
                  style={[styles.input, { backgroundColor: c.inputBg, color: c.text, borderColor: c.border }]}
                />
              </Field>
            </Section>
          ) : null}

          {/* Always show what was derived — a plan built on hidden assumptions is not checkable. */}
          {rangeKm >= 50 ? (
            <View style={[styles.assumptionCard, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}>
              <ThemedText style={[styles.caption, { color: c.textMuted }]}>
                Planning with {spec.realRangeKm} km of range, about {spec.packKwh} kWh of battery,
                charging at up to {spec.dcPeakKw} kW.
              </ThemedText>
            </View>
          ) : null}

          <PrimaryButton
            label={problem ?? (isNew ? 'Add car' : 'Save changes')}
            onPress={onSave}
            disabled={Boolean(problem)}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const c = useThemeColors();
  return (
    <View style={styles.field}>
      <ThemedText style={[styles.label, { color: c.textMuted }]}>{label}</ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 18 },
  caption: { fontSize: 13, lineHeight: 18 },
  field: { gap: 8 },
  label: { fontSize: 14 },
  input: { height: 46, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12 },
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
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
  advancedToggle: { alignSelf: 'center', paddingVertical: 4 },
  advancedText: { fontSize: 14, fontWeight: '700' },
  assumptionCard: { padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
});
