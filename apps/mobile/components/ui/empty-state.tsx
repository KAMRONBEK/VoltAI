import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { useThemeColors } from '@/lib/theme/theme-context';

/**
 * "Nothing here yet", and what to do about it.
 *
 * Built four ways before this — one centred with an icon, one a left-aligned paragraph in a box,
 * two inline — so neighbouring screens reached the same way looked like different products.
 */
export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const c = useThemeColors();
  return (
    <View style={styles.wrap}>
      <MaterialIcons name={icon} size={28} color={c.textMuted} />
      <ThemedText style={styles.title}>{title}</ThemedText>
      {body ? (
        <ThemedText style={[styles.body, { color: c.textMuted }]}>{body}</ThemedText>
      ) : null}
      {actionLabel && onAction ? (
        <PrimaryButton label={actionLabel} onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10, paddingVertical: 48, paddingHorizontal: 24 },
  title: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  action: { marginTop: 6, alignSelf: 'stretch' },
});
