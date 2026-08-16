import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppSheet } from '@/components/ui/app-sheet';
import { PrimaryButton } from '@/components/ui/primary-button';
import { useThemeColors } from '@/lib/theme/theme-context';

/**
 * The app's replacement for `Alert.alert`: a title, a body and one to three actions, in a sheet.
 *
 * `DialogSheet` is the general shape; `ConfirmSheet` (a yes/no with an optional destructive yes)
 * and `InfoSheet` (an "OK" with an optional second action) are the two spellings every call site
 * so far needs. All are controlled by `open` — the caller keeps the thing being asked about in
 * state (`pendingRemove: SavedCar | null`) and passes `open={pendingRemove !== null}`.
 */

export type DialogAction = {
  label: string;
  onPress?: () => void;
  /**
   * `primary` — the filled accent button (the default for the first action).
   * `destructive` — filled red, for something that cannot be undone.
   * `secondary` — outlined; "Cancel", "Not now", "Keep".
   */
  tone?: 'primary' | 'secondary' | 'destructive';
  /** Whether pressing it also closes the sheet. Default true. */
  dismiss?: boolean;
};

export type DialogSheetProps = {
  open: boolean;
  /** Fires once the sheet is fully closed, however that happened. Clear the driving state here. */
  onDismiss?: () => void;
  title: string;
  body?: string;
  icon?: React.ComponentProps<typeof MaterialIcons>['name'];
  /** Icon colour; defaults to the tint, `danger` for a destructive dialog. */
  iconColor?: string;
  actions: DialogAction[];
  /** False for a sheet the user cannot swipe or tap away — only an action closes it. */
  dismissable?: boolean;
  /** Anything to render between the body and the actions. */
  children?: React.ReactNode;
};

/**
 * While the sheet animates closed its driving state is usually already null (`pendingRemove`
 * cleared), so the copy would blank out mid-animation. Keep showing what was there when it was
 * last open. Adjusted during render — the sanctioned way to derive state from props.
 */
function useFrozenWhileClosed<T>(value: T, open: boolean): T {
  const [frozen, setFrozen] = useState(value);
  if (open && frozen !== value) setFrozen(value);
  return open ? value : frozen;
}

export function DialogSheet({
  open,
  onDismiss,
  title,
  body,
  icon,
  iconColor,
  actions,
  dismissable = true,
  children,
}: DialogSheetProps) {
  const c = useThemeColors();
  // Pressing an action that dismisses: close now, and let the caller's `onDismiss` clear state.
  const [closing, setClosing] = useState(false);
  const isOpen = open && !closing;
  if (!open && closing) setClosing(false);

  // Memoised so the freeze below converges: a re-render caused by its own setState sees the same
  // object and stops, rather than minting a new one and setting state again.
  const live = useMemo(
    () => ({ title, body, icon, iconColor, actions, children }),
    [title, body, icon, iconColor, actions, children]
  );
  const shown = useFrozenWhileClosed(live, open);
  const destructive = shown.actions.some((a) => a.tone === 'destructive');

  return (
    <AppSheet
      open={isOpen}
      onDismiss={onDismiss}
      dismissable={dismissable}
      accessibilityLabel={shown.title}
      contentStyle={styles.content}>
      {shown.icon ? (
        <MaterialIcons
          name={shown.icon}
          size={28}
          color={shown.iconColor ?? (destructive ? c.danger : c.tint)}
        />
      ) : null}
      <ThemedText style={styles.title} accessibilityRole="header">
        {shown.title}
      </ThemedText>
      {shown.body ? <ThemedText style={[styles.body, { color: c.textMuted }]}>{shown.body}</ThemedText> : null}
      {shown.children}
      <View style={styles.actions}>
        {shown.actions.map((action, i) => (
          <PrimaryButton
            key={`${action.label}-${i}`}
            label={action.label}
            tone={
              action.tone === 'destructive'
                ? 'danger'
                : action.tone === 'secondary' || (action.tone == null && i > 0)
                  ? 'neutral'
                  : 'accent'
            }
            onPress={() => {
              action.onPress?.();
              if (action.dismiss !== false) setClosing(true);
            }}
          />
        ))}
      </View>
    </AppSheet>
  );
}

/** "Are you sure?" — a destructive or primary yes over an outlined no. */
export function ConfirmSheet({
  open,
  onDismiss,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  icon,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onDismiss?: () => void;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  icon?: DialogSheetProps['icon'];
  onConfirm: () => void;
  onCancel?: () => void;
}) {
  return (
    <DialogSheet
      open={open}
      onDismiss={onDismiss}
      title={title}
      body={body}
      icon={icon}
      actions={[
        { label: confirmLabel, tone: destructive ? 'destructive' : 'primary', onPress: onConfirm },
        { label: cancelLabel, tone: 'secondary', onPress: onCancel },
      ]}
    />
  );
}

/** Something to tell the user, with an "OK" — or a real action plus a way to decline it. */
export function InfoSheet({
  open,
  onDismiss,
  title,
  body,
  icon,
  primaryLabel = 'OK',
  onPrimary,
  secondaryLabel,
  onSecondary,
  dismissable,
  children,
}: {
  open: boolean;
  onDismiss?: () => void;
  title: string;
  body?: string;
  icon?: DialogSheetProps['icon'];
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  dismissable?: boolean;
  children?: React.ReactNode;
}) {
  const actions: DialogAction[] = [{ label: primaryLabel, tone: 'primary', onPress: onPrimary }];
  if (secondaryLabel) actions.push({ label: secondaryLabel, tone: 'secondary', onPress: onSecondary });
  return (
    <DialogSheet
      open={open}
      onDismiss={onDismiss}
      title={title}
      body={body}
      icon={icon}
      actions={actions}
      dismissable={dismissable}>
      {children}
    </DialogSheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, paddingTop: 10 },
  title: { fontSize: 20, fontWeight: '800' },
  body: { fontSize: 15, lineHeight: 21 },
  actions: { gap: 10, marginTop: 8 },
});
