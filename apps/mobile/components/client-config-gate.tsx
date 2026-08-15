import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Constants from 'expo-constants';
import React, { useEffect, useState } from 'react';
import { Alert, Linking, Modal, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { CARD_STYLE } from '@/components/ui/section';
import {
  hasSeenMessage,
  isUpdateRequired,
  loadClientConfig,
  markMessageSeen,
  type ClientConfig,
} from '@/lib/clientConfig';
import { useThemeColors } from '@/lib/theme/theme-context';

/**
 * Applies `GET /api/client-config` to the running app:
 * - `maintenance` → a slim, non-blocking banner above everything ("data may be stale").
 * - `message` → shown once, as an alert; the hash of the text is remembered so it does not nag.
 * - `minAppVersion` above the installed version → a blocking "update required" sheet.
 *
 * Renders its children either way. Everything is fail-open: with no config (offline, an older
 * backend without the route) the app is exactly what it was before this component existed.
 */

const PLAY_PACKAGE = 'uz.voltai.app';
const PLAY_MARKET_URL = `market://details?id=${PLAY_PACKAGE}`;
const PLAY_WEB_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;

const APP_VERSION = Constants.expoConfig?.version;

async function openStoreListing() {
  // `market:` hands off to the Play app; the web URL is what a phone without Play falls back to.
  try {
    await Linking.openURL(PLAY_MARKET_URL);
  } catch {
    await Linking.openURL(PLAY_WEB_URL).catch(() => {});
  }
}

export function ClientConfigGate({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<ClientConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = await loadClientConfig();
      if (cancelled || !cfg) return;
      setConfig(cfg);
      if (cfg.message && !(await hasSeenMessage(cfg.message))) {
        if (cancelled) return;
        Alert.alert('VoltAI', cfg.message);
        void markMessageSeen(cfg.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateRequired = isUpdateRequired(config, APP_VERSION);

  return (
    <View style={styles.root}>
      {children}
      {/* After the children so it paints on top: it overlays the navigator instead of pushing the
          whole tree down by its own height when it appears. */}
      {config?.maintenance ? <MaintenanceBanner /> : null}
      {updateRequired ? <UpdateRequiredSheet minVersion={config?.minAppVersion ?? ''} /> : null}
    </View>
  );
}

function MaintenanceBanner() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.banner,
        { paddingTop: insets.top + 6, backgroundColor: c.surface, borderBottomColor: c.warning },
      ]}
      accessibilityRole="alert">
      <MaterialIcons name="build" size={16} color={c.warning} />
      <ThemedText style={[styles.bannerText, { color: c.text }]}>
        VoltAI is under maintenance — data may be stale
      </ThemedText>
    </View>
  );
}

function UpdateRequiredSheet({ minVersion }: { minVersion: string }) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  return (
    // Not dismissable: no `onRequestClose` action, no backdrop tap. The whole point is that this
    // build must not keep talking to a backend that has moved on.
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={[styles.backdrop, { paddingBottom: insets.bottom + 16 }]}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <MaterialIcons name="system-update" size={28} color={c.tint} />
          <ThemedText style={styles.title}>Update required</ThemedText>
          <ThemedText style={[styles.body, { color: c.textMuted }]}>
            This version of VoltAI ({APP_VERSION ?? '?'}) is no longer supported — the server now
            needs {minVersion} or newer. Update to keep using the map and the trip planner.
          </ThemedText>
          {Platform.OS === 'android' ? (
            <PrimaryButton label="Update in Google Play" onPress={() => void openStoreListing()} style={styles.button} />
          ) : (
            <ThemedText style={[styles.body, { color: c.textMuted }]}>Update VoltAI from the App Store.</ThemedText>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 2,
  },
  bannerText: { fontSize: 13, fontWeight: '600', flex: 1 },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  card: { ...CARD_STYLE, gap: 12, alignItems: 'flex-start' },
  title: { fontSize: 20, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20 },
  button: { alignSelf: 'stretch', marginTop: 4 },
});
