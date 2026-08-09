import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/lib/theme/theme-context';

type Props = {
  badgeCount: number;
  onPress: () => void;
};

export function FilterFab({ badgeCount, onPress }: Props) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.button, { backgroundColor: c.chrome, borderColor: c.chromeBorder, boxShadow: c.chromeShadow }]}
      accessibilityRole="button"
    >
      <MaterialIcons name="tune" size={20} color={c.chromeIcon} />
      {badgeCount > 0 ? (
        <View style={[styles.badge, { backgroundColor: c.tint }]}>
          <ThemedText style={[styles.badgeText, { color: c.onAccent }]}>{badgeCount}</ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 14,
  },
});

