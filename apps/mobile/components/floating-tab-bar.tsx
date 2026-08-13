import type { BottomTabBarProps } from 'expo-router/js-tabs';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColors } from '@/lib/theme/theme-context';

// Route name → SF Symbol / Material icon (see components/ui/icon-symbol).
const ICONS: Record<string, React.ComponentProps<typeof IconSymbol>['name']> = {
  index: 'map.fill',
  route: 'arrow.triangle.branch',
  explore: 'gearshape.fill',
};

/**
 * Bottom padding a tab screen needs so its last row clears the floating pill.
 *
 * The pill sits at `insets.bottom + 16` and is 56 tall, so its top edge is at `insets.bottom + 72`;
 * this leaves 24 px of air above it. Exported because it was previously copied as three different
 * numbers into five screens, which is why the gap above the pill changed as you moved around.
 * Screens NOT under the tab bar — the garage, the planner's pushed screens — must not use it.
 */
export const TAB_BAR_CLEARANCE = 96;

/**
 * Compact, floating, icon-only pill tab bar. Rendered via the Tabs `tabBar` prop so we control
 * the exact size: an absolutely-positioned wrapper centers a row that only spans its icons
 * (not the full width). Screens render underneath — each adds `TAB_BAR_CLEARANCE`.
 */
export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 16 }]}>
      <View
        style={[
          styles.pill,
          {
            backgroundColor: c.tabBar,
            borderColor: c.border,
            boxShadow: c.chromeShadow,
          },
        ]}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : options.title ?? route.name;
          const focused = state.index === index;
          const color = focused ? c.tint : c.tabIconDefault;
          const icon = ICONS[route.name] ?? 'map.fill';

          const onPress = () => {
            if (process.env.EXPO_OS === 'ios') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={label}
              style={styles.item}>
              <IconSymbol size={26} name={icon} color={color} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Full-width, out-of-flow layer that centers the pill; box-none lets map touches pass through
  // the empty area on either side.
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: 6,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
  },
  item: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 24,
  },
});
