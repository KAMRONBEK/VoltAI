import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/lib/theme/theme-context';

/**
 * An uppercase heading over a card — the layout unit of every form screen in the app.
 *
 * Implemented three times before this (trip input, settings, garage) with different card padding,
 * so rows sat tighter on one screen than on the visually identical card next door.
 */
export function Section({
  title,
  children,
  action,
  style,
}: {
  title: string;
  children: React.ReactNode;
  /** Optional trailing control on the heading row, e.g. a "Reset" link. */
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useThemeColors();
  return (
    <View style={[styles.section, style]}>
      <View style={styles.headingRow}>
        <ThemedText style={[styles.heading, { color: c.textMuted }]}>{title}</ThemedText>
        {action}
      </View>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        {children}
      </View>
    </View>
  );
}

/** The card alone, for lists whose rows are not grouped under a heading. */
export const CARD_STYLE = {
  padding: 16,
  borderRadius: 18,
  borderWidth: StyleSheet.hairlineWidth,
} as const;

const styles = StyleSheet.create({
  section: { gap: 8 },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginLeft: 4,
    marginRight: 4,
  },
  heading: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  card: { ...CARD_STYLE, gap: 12 },
});
