import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/lib/theme/theme-context';

/**
 * A row of mutually exclusive choices, sized once for the whole app.
 *
 * Built four times before this — Appearance, How-you-drive, range source, and the plan options —
 * in three heights and with two different active-border colours, and only one copy announced its
 * selection to a screen reader.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useThemeColors();
  return (
    <View style={[styles.track, { backgroundColor: c.surfaceSunken }, style]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.item,
              {
                backgroundColor: active ? c.surface : 'transparent',
                borderColor: active ? c.borderStrong : 'transparent',
              },
            ]}>
            <ThemedText style={[styles.label, { color: active ? c.text : c.textMuted }]}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4 },
  item: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 14, fontWeight: '600' },
});
