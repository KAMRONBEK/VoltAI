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
 *
 * `tone` exists for dialog sheets: `danger` is the filled red of an irreversible action ("Remove",
 * "Forget"), `neutral` the outlined secondary next to it ("Cancel", "Not now"). Same size as the
 * accent button, so a pair of them lines up.
 */
export function PrimaryButton({
  label,
  onPress,
  disabled,
  style,
  accessibilityLabel,
  tone = 'accent',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  tone?: 'accent' | 'danger' | 'neutral';
}) {
  const c = useThemeColors();
  const fill =
    tone === 'danger'
      ? { backgroundColor: c.danger }
      : tone === 'neutral'
        ? { backgroundColor: c.surface, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth }
        : { backgroundColor: c.accent };
  const ink = tone === 'danger' ? '#FFFFFF' : tone === 'neutral' ? c.text : c.onAccent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.button, fill, disabled ? styles.disabled : null, style]}>
      <ThemedText style={[styles.label, { color: ink }]}>{label}</ThemedText>
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
