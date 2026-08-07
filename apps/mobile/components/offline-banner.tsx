import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/lib/theme/theme-context';

type Props = {
  visible: boolean;
};

export function OfflineBanner({ visible }: Props) {
  const c = useThemeColors();
  if (!visible) return null;

  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={[styles.pill, { backgroundColor: c.chrome, borderColor: c.chromeBorder }]}>
        <View style={[styles.dot, { backgroundColor: c.danger }]} />
        <ThemedText type="defaultSemiBold" style={{ color: c.chromeText }}>
          Offline
        </ThemedText>
        <ThemedText style={[styles.sub, { color: c.chromeText }]}>Using cached data</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  sub: {
    opacity: 0.8,
  },
});

