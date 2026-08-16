import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
  type BottomSheetModalProps,
} from '@gorhom/bottom-sheet';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColors } from '@/lib/theme/theme-context';

/**
 * The one way this app presents anything over a screen: a Gorhom bottom sheet.
 *
 * Every modal, dialog, info panel and detail card goes through this file so they all share one
 * corner radius, one handle, one backdrop and one bottom inset. Two shapes are exported:
 *
 * - `AppSheet` — a `BottomSheetModal`, presented over whatever screen is showing (the provider is
 *   mounted once in `app/_layout.tsx`). Controlled by an `open` boolean; sizes itself to its
 *   content unless `snapPoints` are given; `dismissable={false}` makes it a blocking sheet.
 * - `useSheetChrome()` + the `SHEET_*` constants — for the inline `BottomSheet`s that live in a
 *   screen's own tree (the station card, the filters, the trip itinerary), so those look identical
 *   to the modals without becoming modals.
 */

/** Top corner radius of every sheet — the station card's value, now shared. */
export const SHEET_RADIUS = 24;
/** Backdrop dimming behind a modal sheet. The map-side inline sheets have no backdrop. */
export const SHEET_BACKDROP_OPACITY = 0.5;
/** Horizontal content inset inside a sheet. */
export const SHEET_PADDING_H = 16;
/** Air between the last row and the bottom of the sheet (added to the safe-area inset). */
export const SHEET_PADDING_BOTTOM = 20;

/**
 * Background + handle styles shared by every sheet. Returned as props to spread onto a
 * `BottomSheet` / `BottomSheetModal`, so the two kinds cannot drift apart.
 */
export function useSheetChrome() {
  const c = useThemeColors();
  return useMemo(
    () => ({
      backgroundStyle: [styles.background, { backgroundColor: c.background }] as StyleProp<ViewStyle>,
      handleIndicatorStyle: { backgroundColor: c.handle } as StyleProp<ViewStyle>,
    }),
    [c.background, c.handle]
  );
}

export type AppSheetRef = {
  /** Present the sheet (also done for you when `open` turns true). */
  present: () => void;
  /** Dismiss the sheet (also done for you when `open` turns false). */
  dismiss: () => void;
  snapToIndex: (index: number) => void;
  expand: () => void;
  collapse: () => void;
};

export type AppSheetProps = {
  /** Whether the sheet is presented. Flip to false to dismiss with the close animation. */
  open: boolean;
  /**
   * Called once the sheet has fully closed — after a backdrop tap, a pan-down, an action that
   * dismisses, or `open` turning false. Callers use this to clear the state that drove `open`.
   */
  onDismiss?: () => void;
  /**
   * Fixed snap points. Omit for a sheet that sizes itself to its content (dynamic sizing, capped at
   * the top safe-area inset).
   */
  snapPoints?: (string | number)[];
  /** Initial snap index when `snapPoints` are given. */
  initialIndex?: number;
  /**
   * False for a sheet the user must not be able to get rid of (the "update required" gate): no
   * backdrop tap, no pan-to-close, no drag at all, and no handle — a handle promises a drag.
   */
  dismissable?: boolean;
  /**
   * Whether the content scrolls. Content-sized sheets rarely need it; pass true for anything that
   * can outgrow the screen (the scroll view still measures for dynamic sizing).
   */
  scrollable?: boolean;
  /** Style for the content container (padding is already applied; add gap etc.). */
  contentStyle?: StyleProp<ViewStyle>;
  /** Extra space above the safe-area bottom — e.g. `TAB_BAR_CLEARANCE` on a tab screen. */
  bottomInset?: number;
  keyboardBehavior?: BottomSheetModalProps['keyboardBehavior'];
  android_keyboardInputMode?: BottomSheetModalProps['android_keyboardInputMode'];
  /** How this sheet stacks on one already open. Default `push` — a dialog over a detail sheet. */
  stackBehavior?: BottomSheetModalProps['stackBehavior'];
  /** Reads to screen readers as the sheet's name. */
  accessibilityLabel?: string;
  children: React.ReactNode;
};

export const AppSheet = forwardRef<AppSheetRef, AppSheetProps>(function AppSheet(
  {
    open,
    onDismiss,
    snapPoints,
    initialIndex = 0,
    dismissable = true,
    scrollable = false,
    contentStyle,
    bottomInset = 0,
    keyboardBehavior,
    android_keyboardInputMode,
    stackBehavior = 'push',
    accessibilityLabel,
    children,
  },
  ref
) {
  const insets = useSafeAreaInsets();
  const chrome = useSheetChrome();
  const modalRef = useRef<BottomSheetModal | null>(null);
  /**
   * Whether we currently believe the modal is presented. `dismiss()` must never be called on a
   * modal that is not: gorhom marks it "dismissing" and then refuses to render it the next time
   * it is presented — the sheet would silently never appear again.
   */
  const presentedRef = useRef(false);
  /** Bumped every time the modal finishes closing, so the effect below re-checks `open`. */
  const [dismissTick, setDismissTick] = useState(0);

  const present = useCallback(() => {
    if (presentedRef.current) return;
    presentedRef.current = true;
    modalRef.current?.present();
  }, []);
  const dismiss = useCallback(() => {
    if (!presentedRef.current) return;
    modalRef.current?.dismiss();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      present,
      dismiss,
      snapToIndex: (i) => modalRef.current?.snapToIndex(i),
      expand: () => modalRef.current?.expand(),
      collapse: () => modalRef.current?.collapse(),
    }),
    [present, dismiss]
  );

  const handleDismissed = useCallback(() => {
    presentedRef.current = false;
    onDismiss?.();
    setDismissTick((t) => t + 1);
  }, [onDismiss]);

  // Controlled: the modal is presented exactly when `open` says so. Re-checked after every close
  // as well, so a sheet that was re-opened during its own closing animation comes back.
  useEffect(() => {
    if (open) present();
    else dismiss();
  }, [open, dismissTick, present, dismiss]);

  // Android back while a sheet is up: close the sheet, not the screen under it — what the Alert
  // and Modal this replaces both did. A blocking sheet swallows the press and stays.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (dismissable) dismiss();
      return true;
    });
    return () => sub.remove();
  }, [open, dismissable, dismiss]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={SHEET_BACKDROP_OPACITY}
        pressBehavior={dismissable ? 'close' : 'none'}
      />
    ),
    [dismissable]
  );

  const dynamic = !snapPoints;
  const paddingBottom = insets.bottom + bottomInset + SHEET_PADDING_BOTTOM;
  const content = [
    styles.content,
    // Without a handle the content needs its own breathing room at the top.
    dismissable ? null : styles.contentNoHandle,
    { paddingBottom },
    contentStyle,
  ];

  return (
    <BottomSheetModal
      ref={modalRef}
      accessibilityLabel={accessibilityLabel}
      index={dynamic ? 0 : initialIndex}
      snapPoints={snapPoints}
      enableDynamicSizing={dynamic}
      topInset={insets.top}
      onDismiss={handleDismissed}
      backdropComponent={renderBackdrop}
      stackBehavior={stackBehavior}
      enablePanDownToClose={dismissable}
      enableContentPanningGesture={dismissable}
      enableHandlePanningGesture={dismissable}
      enableOverDrag={dismissable}
      handleComponent={dismissable ? undefined : null}
      keyboardBehavior={keyboardBehavior}
      android_keyboardInputMode={android_keyboardInputMode}
      {...chrome}>
      {scrollable ? (
        <BottomSheetScrollView
          contentContainerStyle={content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          {children}
        </BottomSheetScrollView>
      ) : (
        <BottomSheetView style={content}>{children}</BottomSheetView>
      )}
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  background: { borderTopLeftRadius: SHEET_RADIUS, borderTopRightRadius: SHEET_RADIUS },
  content: { paddingHorizontal: SHEET_PADDING_H, paddingTop: 6 },
  contentNoHandle: { paddingTop: 22 },
});
