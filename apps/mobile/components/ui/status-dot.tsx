import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { statusColor } from '@/constants/theme';
import { useThemeColors } from '@/lib/theme/theme-context';
import type { Station } from '@/types/stations';

/**
 * The charger-status dot. One size, one radius, one colour source.
 *
 * Six copies existed at three sizes, so scanning down the station sheet the dot beside the name,
 * the one in the co-located switcher and the ones on the connector rows all changed size.
 */
export function StatusDot({
  status,
  color,
  size = 9,
  style,
}: {
  status?: Station['status'];
  /** Only for dots that are not a charger status — the offline chrome indicator. */
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useThemeColors();
  return (
    <View
      style={[
        styles.dot,
        { width: size, height: size, backgroundColor: color ?? statusColor(status, c) },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: { borderRadius: 999 },
});
