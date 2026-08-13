import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/lib/theme/theme-context';

export type TagTone = 'warn' | 'muted' | 'danger' | 'accent';

/**
 * A small, read-only label: "Unavoidable stop", "Power unconfirmed", "GB/T connector".
 *
 * Not a chip — nothing here is tappable, which is why it is a separate component rather than a
 * ChoiceChip with `onPress` omitted. `warn` is amber, not red: every warning this app shows
 * describes the planner behaving correctly under a stated limitation. Red is reserved for
 * `danger`, which means the thing the user wants cannot be done.
 */
export function Tag({
  text,
  tone = 'muted',
  accentColor,
  leading,
}: {
  text: string;
  tone?: TagTone;
  /** Overrides the tone colour where the colour itself carries meaning (charger categories). */
  accentColor?: string;
  leading?: React.ReactNode;
}) {
  const c = useThemeColors();
  const toneColor =
    accentColor ??
    (tone === 'warn' ? c.warning : tone === 'danger' ? c.danger : tone === 'accent' ? c.tint : c.textMuted);

  return (
    <View style={[styles.tag, { borderColor: toneColor }]}>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <ThemedText style={[styles.label, { color: toneColor }]}>{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  leading: { alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, fontWeight: '600' },
});
