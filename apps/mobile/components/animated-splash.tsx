import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';
import LottieView from 'lottie-react-native';

type Props = {
  children: React.ReactNode;
};

export function AnimatedSplash({ children }: Props) {
  const [showOverlay, setShowOverlay] = useState(true);
  const [nativeSplashHidden, setNativeSplashHidden] = useState(false);

  const opacity = useSharedValue(1);
  const lottieRef = useRef<any>(null);

  const hideOverlay = useCallback(() => {
    opacity.value = withTiming(0, { duration: 280 }, (finished) => {
      if (finished) runOnJS(setShowOverlay)(false);
    });
  }, [opacity]);

  const onRootLayout = useCallback(
    (e: LayoutChangeEvent) => {
      // Wait for a non-zero layout before hiding the native splash.
      if (nativeSplashHidden) return;
      if (e.nativeEvent.layout.width <= 0 || e.nativeEvent.layout.height <= 0) return;
      setNativeSplashHidden(true);
      SplashScreen.hideAsync().catch(() => undefined);
    },
    [nativeSplashHidden]
  );

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }), [opacity]);

  // Keep the splash background stable across modes; the native splash background is also black.
  const backgroundColor = '#000000';

  return (
    <View style={styles.root} onLayout={onRootLayout}>
      {children}
      {showOverlay ? (
        <Animated.View style={[styles.overlay, { backgroundColor }, overlayStyle]}>
          <LottieView
            ref={lottieRef}
            source={require('../assets/animations/splash.json')}
            autoPlay
            loop={false}
            onAnimationFinish={(isCancelled) => {
              if (!isCancelled) hideOverlay();
            }}
            style={styles.lottie}
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lottie: {
    width: 220,
    height: 220,
  },
});

