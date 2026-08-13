import React from 'react';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChromePill } from '@/components/ui/chrome-pill';
import { StatusDot } from '@/components/ui/status-dot';
import { useThemeColors } from '@/lib/theme/theme-context';

type Props = {
  visible: boolean;
};

export function OfflineBanner({ visible }: Props) {
  const c = useThemeColors();
  if (!visible) return null;

  return (
    <ChromePill>
      <StatusDot status="offline" />
      <ThemedText type="defaultSemiBold" style={{ color: c.chromeText }}>
        Offline
      </ThemedText>
      <ThemedText style={[styles.sub, { color: c.chromeText }]}>Using cached data</ThemedText>
    </ChromePill>
  );
}

const styles = StyleSheet.create({
  sub: { fontSize: 13 },
});
