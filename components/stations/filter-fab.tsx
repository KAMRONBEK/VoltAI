import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';

type Props = {
  badgeCount: number;
  onPress: () => void;
};

export function FilterFab({ badgeCount, onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={styles.button} accessibilityRole="button">
      <MaterialIcons name="tune" size={20} color="#ECEDEE" />
      {badgeCount > 0 ? (
        <View style={styles.badge}>
          <ThemedText style={styles.badgeText}>{badgeCount}</ThemedText>
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
    backgroundColor: 'rgba(18, 18, 18, 0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: '#2FE28A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#0b0b0b',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 14,
  },
});

