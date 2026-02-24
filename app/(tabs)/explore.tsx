import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { OfflineBanner } from '@/components/offline-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useIsOffline } from '@/hooks/use-is-offline';
import { loadVehicleProfile, saveVehicleProfile, type VehicleProfile } from '@/lib/vehicles/vehicleProfile';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function ProfileScreen() {
  const colorScheme = useColorScheme() ?? 'dark';
  const isOffline = useIsOffline();

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
        <View style={styles.header}>
          <ThemedText type="title">Profile</ThemedText>
          <ThemedText style={styles.sub}>Save your EV so the app can filter chargers later.</ThemedText>
        </View>

        <View style={styles.card}>
          <ThemedText type="defaultSemiBold">Vehicle</ThemedText>

          <View style={styles.field}>
            <ThemedText style={styles.label}>Make</ThemedText>
            <TextInput
              value={make}
              onChangeText={setMake}
              placeholder="Tesla"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="words"
              style={[
                styles.input,
                { color: Colors[colorScheme].text, borderColor: 'rgba(255,255,255,0.12)' },
              ]}
            />
          </View>

          <View style={styles.field}>
            <ThemedText style={styles.label}>Model</ThemedText>
            <TextInput
              value={model}
              onChangeText={setModel}
              placeholder="Model Y"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="words"
              style={[
                styles.input,
                { color: Colors[colorScheme].text, borderColor: 'rgba(255,255,255,0.12)' },
              ]}
            />
          </View>

          <View style={styles.field}>
            <ThemedText style={styles.label}>Range (km)</ThemedText>
            <TextInput
              value={rangeKmText}
              onChangeText={(t) => setRangeKmText(t.replace(/[^\d]/g, ''))}
              placeholder="420"
              placeholderTextColor="rgba(255,255,255,0.35)"
              keyboardType="number-pad"
              style={[
                styles.input,
                { color: Colors[colorScheme].text, borderColor: 'rgba(255,255,255,0.12)' },
              ]}
            />
          </View>

          <Pressable
            onPress={onSave}
            disabled={!canSave || isSaving}
            style={[
              styles.saveButton,
              { backgroundColor: Colors[colorScheme].tint },
              !canSave || isSaving ? styles.saveButtonDisabled : null,
            ]}>
            <ThemedText style={styles.saveText}>
              {isSaving ? 'Saving…' : canSave ? 'Save' : 'Fill all fields'}
            </ThemedText>
          </Pressable>

          {savedAt ? <ThemedText style={styles.savedHint}>Saved</ThemedText> : null}
        </View>
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
    paddingBottom: 24,
  },
  header: {
    gap: 6,
    marginBottom: 14,
  },
  sub: {
    opacity: 0.75,
  },
  card: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    gap: 14,
  },
  field: {
    gap: 8,
  },
  label: {
    opacity: 0.8,
  },
  input: {
    height: 46,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(0,0,0,0.18)',
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
    color: '#0b0b0b',
    fontWeight: '800',
  },
  savedHint: {
    opacity: 0.7,
    textAlign: 'center',
  },
});
