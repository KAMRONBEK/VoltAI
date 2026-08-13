import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/lib/theme/theme-context';

/**
 * A tappable, selectable chip — cities, battery percentages, filter pills.
 *
 * One gesture that existed in five shapes, with selection encoded four different ways (a fill, a
 * border, a tint wash, a border weight change that shifted the layout by a pixel). Selection is a
 * solid fill here, because a hairline border change is nearly invisible in light mode.
 *
 * `accentColor` exists for the category pills, whose colour carries meaning: they wash their own
 * colour rather than taking the brand green, but keep the same geometry as every other chip.
 */
export function ChoiceChip({
  label,
  selected,
  onPress,
  leading,
  accentColor,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  leading?: React.ReactNode;
  accentColor?: string;
}) {
  const c = useThemeColors();
  const accent = accentColor ?? c.tint;

  const background = !selected ? c.surfaceSunken : accentColor ? `${accent}26` : accent;
  const border = selected ? accent : c.border;
  const labelColor = !selected ? c.text : accentColor ? c.text : c.onAccent;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, { backgroundColor: background, borderColor: border }]}>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <ThemedText style={[styles.label, { color: labelColor }]}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  leading: { alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '600' },
});
