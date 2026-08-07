import Constants from 'expo-constants';
import React, { useEffect, useMemo, useState } from 'react';
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

import { OfflineBanner } from '@/components/offline-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useIsOffline } from '@/hooks/use-is-offline';
import { type ThemePreference } from '@/lib/settings/appSettings';
import { useTheme, useThemeColors } from '@/lib/theme/theme-context';
import { loadVehicleProfile, saveVehicleProfile, type VehicleProfile } from '@/lib/vehicles/vehicleProfile';

const APPEARANCE_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

/** A titled, rounded card grouping — uppercase heading over a surface card. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useThemeColors();
  return (
    <View style={styles.section}>
      <ThemedText style={[styles.sectionHeading, { color: c.textMuted }]}>{title}</ThemedText>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        {children}
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const c = useThemeColors();
  const { preference, setPreference } = useTheme();
  const isOffline = useIsOffline();
  const insets = useSafeAreaInsets();

  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [rangeKmText, setRangeKmText] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const profile = await loadVehicleProfile();
      if (!profile || cancelled) return;
      setMake(profile.make);
      setModel(profile.model);
      setRangeKmText(String(profile.rangeKm));
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const rangeKm = useMemo(() => {
    const n = Number(rangeKmText);
    if (!Number.isFinite(n)) return null;
    if (n <= 0) return null;
    return Math.round(n);
  }, [rangeKmText]);

  const canSave = make.trim().length > 0 && model.trim().length > 0 && rangeKm !== null;

  async function onSave() {
    if (!canSave || rangeKm === null) return;

    const profile: VehicleProfile = {
      make: make.trim(),
      model: model.trim(),
      rangeKm,
    };

    setIsSaving(true);
    try {
      await saveVehicleProfile(profile);
      setSavedAt(Date.now());
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.topOverlay}>
        <OfflineBanner visible={isOffline} />
      </View>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 96 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="title">Settings</ThemedText>
          </View>

          {/* Appearance — the headline theme switch. */}
          <Section title="Appearance">
            <View style={[styles.segTrack, { backgroundColor: c.surfaceSunken }]}>
              {APPEARANCE_OPTIONS.map((opt) => {
                const active = preference === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setPreference(opt.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.segItem,
                      { borderColor: 'transparent' },
                      active && { backgroundColor: c.surface, borderColor: c.border },
                    ]}>
                    <ThemedText
                      style={[styles.segLabel, { color: active ? c.text : c.textMuted }]}>
                      {opt.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
            <ThemedText style={[styles.caption, { color: c.textMuted }]}>
              Applies instantly across the app.
            </ThemedText>
          </Section>

          {/* Your EV — optional, device-local. */}
          <Section title="Your EV">
            <ThemedText style={[styles.caption, { color: c.textMuted }]}>
              Optional — saved on this device to tailor charger suggestions.
            </ThemedText>

            <View style={styles.field}>
              <ThemedText style={[styles.label, { color: c.textMuted }]}>Make</ThemedText>
              <TextInput
                value={make}
                onChangeText={setMake}
                placeholder="Tesla"
                placeholderTextColor={c.placeholder}
                autoCapitalize="words"
                style={[styles.input, { backgroundColor: c.inputBg, color: c.text, borderColor: c.border }]}
              />
            </View>

            <View style={styles.field}>
              <ThemedText style={[styles.label, { color: c.textMuted }]}>Model</ThemedText>
              <TextInput
                value={model}
                onChangeText={setModel}
                placeholder="Model Y"
                placeholderTextColor={c.placeholder}
                autoCapitalize="words"
                style={[styles.input, { backgroundColor: c.inputBg, color: c.text, borderColor: c.border }]}
              />
            </View>

            <View style={styles.field}>
              <ThemedText style={[styles.label, { color: c.textMuted }]}>Range (km)</ThemedText>
              <TextInput
                value={rangeKmText}
                onChangeText={(t) => setRangeKmText(t.replace(/[^\d]/g, ''))}
                placeholder="420"
                placeholderTextColor={c.placeholder}
                keyboardType="number-pad"
                style={[styles.input, { backgroundColor: c.inputBg, color: c.text, borderColor: c.border }]}
              />
            </View>

            <Pressable
              onPress={onSave}
              disabled={!canSave || isSaving}
              style={[
                styles.saveButton,
                { backgroundColor: c.accent },
                !canSave || isSaving ? styles.saveButtonDisabled : null,
              ]}>
              <ThemedText style={[styles.saveText, { color: c.onAccent }]}>
                {isSaving ? 'Saving…' : canSave ? 'Save' : 'Fill all fields'}
              </ThemedText>
            </Pressable>

            {savedAt ? (
              <ThemedText style={[styles.savedHint, { color: c.textMuted }]}>Saved</ThemedText>
            ) : null}
          </Section>

          {/* About — account-free, on-device. */}
          <Section title="About">
            <ThemedText style={[styles.aboutBody, { color: c.textMuted }]}>
              VoltAI is account-free. Your preferences and vehicle stay on this device — no sign-in,
              no cloud.
            </ThemedText>
            <ThemedText style={[styles.aboutVersion, { color: c.textMuted }]}>
              Version {APP_VERSION}
            </ThemedText>
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 10,
  },
  body: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 72,
  },
  scrollContent: {
    paddingBottom: 32,
    gap: 22,
  },
  header: {
    gap: 6,
    marginBottom: 2,
  },
  section: {
    gap: 8,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginLeft: 4,
  },
  card: {
    padding: 16,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 14,
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
  },
  segTrack: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  segItem: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 14,
  },
  input: {
    height: 46,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  saveButton: {
    marginTop: 6,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.55,
  },
  saveText: {
    fontWeight: '800',
  },
  savedHint: {
    textAlign: 'center',
  },
  aboutBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  aboutVersion: {
    fontSize: 13,
  },
});
