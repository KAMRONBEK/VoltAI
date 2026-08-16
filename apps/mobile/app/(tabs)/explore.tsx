import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useAtomValue } from 'jotai';
import React from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from '@/components/floating-tab-bar';
import { OfflineBanner } from '@/components/offline-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Section } from '@/components/ui/section';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useIsOffline } from '@/hooks/use-is-offline';
import {
  ARRIVAL_RESERVE_OPTIONS,
  useArrivalReservePct,
  type ArrivalReservePct,
  type ThemePreference,
} from '@/lib/settings/appSettings';
import { useTheme, useThemeColors } from '@/lib/theme/theme-context';
import { carsAtom, selectedCarAtom } from '@/lib/vehicles/garage-atoms';

const APPEARANCE_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

// SegmentedControl keys on strings; the setting is a number, so map both ways at the edge.
const ARRIVAL_RESERVE_SEGMENTS = ARRIVAL_RESERVE_OPTIONS.map((pct) => ({
  value: String(pct),
  label: `${pct} %`,
}));

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
const PRIVACY_POLICY_URL = 'https://voltai.uz/uz/privacy';

function openPrivacyPolicy() {
  WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL).catch(() => Linking.openURL(PRIVACY_POLICY_URL).catch(() => {}));
}

/** A titled, rounded card grouping — uppercase heading over a surface card. */

export default function SettingsScreen() {
  const c = useThemeColors();
  const { preference, setPreference } = useTheme();
  const [arrivalReservePct, setArrivalReservePct] = useArrivalReservePct();
  const isOffline = useIsOffline();
  const insets = useSafeAreaInsets();

  const cars = useAtomValue(carsAtom);
  const selectedCar = useAtomValue(selectedCarAtom);
  const carCount = cars.length;

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.topOverlay, { top: insets.top + 10 }]}>
        <OfflineBanner visible={isOffline} />
      </View>

      <KeyboardAvoidingView
        style={[styles.body, { paddingTop: insets.top + 12 }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="title">Settings</ThemedText>
          </View>

          {/* Appearance — the headline theme switch. */}
          <Section title="Appearance">
            <SegmentedControl
              options={APPEARANCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              value={preference}
              onChange={setPreference}
            />
            <ThemedText style={[styles.caption, { color: c.textMuted }]}>
              Applies instantly across the app.
            </ThemedText>
          </Section>

          {/* Trip planning — a device setting rather than a per-trip control: the reserve is how
              cautious the driver is, not a property of one journey, and it must not be re-asked
              on every plan. Sent to the planner as `reservePct`. */}
          <Section title="Trip planning">
            <ThemedText style={[styles.fieldLabel, { color: c.text }]}>Arrive with at least</ThemedText>
            <SegmentedControl
              options={ARRIVAL_RESERVE_SEGMENTS}
              value={String(arrivalReservePct)}
              onChange={(value) => setArrivalReservePct(Number(value) as ArrivalReservePct)}
            />
            <ThemedText style={[styles.caption, { color: c.textMuted }]}>
              The planner keeps this much battery in reserve at your destination and never plans a
              leg that ends below it.
            </ThemedText>
          </Section>

          {/* Cars live in the garage now: a trip plan needs a connector type and charging
              details that do not fit in a three-field inline form. */}
          <Section title="Your cars">
            <ThemedText style={[styles.caption, { color: c.textMuted }]}>
              Saved on this device to plan trips and match chargers your car can actually use.
            </ThemedText>
            <Pressable
              onPress={() => router.push('/garage')}
              style={[styles.linkRow, { borderColor: c.border }]}>
              <ThemedText style={[styles.linkLabel, { color: c.text }]}>
                {carCount === 0
                  ? 'Add your car'
                  : carCount === 1
                    ? (selectedCar?.label || '1 car saved')
                    : `${carCount} cars saved`}
              </ThemedText>
              <MaterialIcons name="chevron-right" size={22} color={c.textMuted} />
            </Pressable>
            {selectedCar && !selectedCar.plug ? (
              <ThemedText style={[styles.caption, { color: c.danger }]}>
                Connector not set — trip planning needs it.
              </ThemedText>
            ) : null}
          </Section>

          {/* Privacy — said the way it actually works, planner included. */}
          <Section title="Privacy">
            <ThemedText style={[styles.aboutBody, { color: c.textMuted }]}>
              VoltAI is account-free. Your preferences and cars are stored on this device. When you
              plan a trip, only the start and end coordinates and the car figures needed to compute
              the route are sent to VoltAI’s server (and forwarded to a routing provider) — never an
              identity, and nothing is kept about you. No analytics, no ads, no tracking.
            </ThemedText>
            <Pressable
              onPress={openPrivacyPolicy}
              style={[styles.linkRow, { borderColor: c.border }]}
              accessibilityRole="link">
              <ThemedText style={[styles.linkLabel, { color: c.text }]}>Privacy Policy</ThemedText>
              <MaterialIcons name="open-in-new" size={20} color={c.textMuted} />
            </Pressable>
          </Section>

          {/* About */}
          <Section title="About">
            <ThemedText style={[styles.aboutBody, { color: c.textMuted }]}>
              Not affiliated with any charging operator. Station data comes from operators’ public
              apps and may be delayed or incomplete — check the charger before you rely on it.
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
    left: 12,
    right: 12,
    zIndex: 10,
  },
  body: {
    flex: 1,
    paddingHorizontal: 16,
  },
  scrollContent: {
    paddingBottom: 32,
    gap: 22,
  },
  header: {
    gap: 6,
    marginBottom: 2,
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
  },
  fieldLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  linkLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  aboutBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  aboutVersion: {
    fontSize: 13,
  },
});
