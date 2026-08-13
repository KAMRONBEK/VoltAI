import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useThemeColors } from '@/lib/theme/theme-context';

/**
 * A floating capsule drawn over the map: "Live", "Offline", "Loading stations…", the legend.
 *
 * These are one element, and were built four times in two radii and two shapes — so when loading
 * finished, a flat rounded rectangle was replaced in the same position by a shadowed capsule and
 * the overlay visibly changed shape under the user. Anything painted on `c.chrome` carries
 * `c.chromeBorder` and `c.chromeShadow` as a set; that is what makes it read as floating.
 */
export function ChromePill({
  children,
  tone = 'neutral',
  style,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'warn';
  style?: StyleProp<ViewStyle>;
}) {
  const c = useThemeColors();
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: c.chrome,
          borderColor: tone === 'warn' ? c.warning : c.chromeBorder,
          boxShadow: c.chromeShadow,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
