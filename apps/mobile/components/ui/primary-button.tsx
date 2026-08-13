import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/lib/theme/theme-context';

/**
 * The app's one filled call-to-action.
 *
 * Previously re-declared in seven StyleSheets with three heights, two radii and two label sizes,
 * so "Navigate" on the station sheet was visibly smaller than "Plan trip" two taps away. Outer
 * spacing belongs to the caller via `style` — the button never carries its own margin, or the
 * next screen inherits a gap it did not ask for.
 */
export function PrimaryButton({
  label,
  onPress,
  disabled,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.button, { backgroundColor: c.accent }, disabled ? styles.disabled : null, style]}>
      <ThemedText style={[styles.label, { color: c.onAccent }]}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 50,
    borderRadius: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.55 },
});
