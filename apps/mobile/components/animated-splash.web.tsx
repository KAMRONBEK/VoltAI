import React, { useCallback, useRef, useState } from 'react';
import { Image, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';

type Props = {
  children: React.ReactNode;
};

export function AnimatedSplash({ children }: Props) {
  const [showOverlay, setShowOverlay] = useState(true);
  const [nativeSplashHidden, setNativeSplashHidden] = useState(false);

  const opacity = useSharedValue(1);
  const hideTimeout = useRef<number | null>(null);

  const hideOverlay = useCallback(() => {
    opacity.value = withTiming(0, { duration: 220 }, (finished) => {
      if (finished) runOnJS(setShowOverlay)(false);
    });
  }, [opacity]);

  const onRootLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (!nativeSplashHidden && e.nativeEvent.layout.width > 0 && e.nativeEvent.layout.height > 0) {
        setNativeSplashHidden(true);
        SplashScreen.hideAsync().catch(() => undefined);

        // Web: keep it simple (short hold + fade) to avoid extra web-only deps.
        hideTimeout.current = window.setTimeout(() => hideOverlay(), 650);
      }
    },
    [hideOverlay, nativeSplashHidden]
  );

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }), [opacity]);

  return (
    <View style={styles.root} onLayout={onRootLayout}>
      {children}
      {showOverlay ? (
        <Animated.View style={[styles.overlay, overlayStyle]}>
          <Image
            source={require('../assets/images/splash-icon.png')}
            style={styles.mark}
            resizeMode="contain"
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: 180,
    height: 180,
  },
});

