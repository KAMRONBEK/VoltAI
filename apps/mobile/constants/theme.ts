/**
 * Semantic color tokens for the app, defined for both light and dark schemes.
 *
 * Consume these via `useThemeColors()` (returns the active scheme's token set) or
 * `useThemeColor({ light, dark }, token)` for a single value. The two token maps MUST stay
 * key-symmetric — `useThemeColor`'s type is `keyof light & keyof dark`, and the whole app
 * assumes every token exists in both schemes.
 *
 * Status colors (available / in_use / offline / unknown) are intentionally identical across
 * schemes so the sheet's dots match the baked-in marker PNGs on the map.
 */

import { Platform } from 'react-native';

// Brand palette
const brandGreenDark = '#0B3D2E';
const brandGreenNeon = '#2FE28A';
const brandRed = '#E53935';

// Charger status — shared across both schemes to match the marker images.
const statusAvailable = '#2FE28A';
const statusInUse = '#F7B84B';
const statusOffline = '#6D6D6D';
const statusUnknown = '#9BA1A6';

export type ThemeColors = {
  /** Page background (shows behind sheets, settings, the map). */
  background: string;
  /** Raised card / row surface on top of the background. */
  surface: string;
  /** A second, slightly stronger elevation (chips, nested cards). */
  surfaceElevated: string;
  /** Recessed surface (inputs, wells). */
  surfaceSunken: string;

  /** Primary body text. */
  text: string;
  /** Secondary / muted text. */
  textMuted: string;
  /** Neutral icon color for on-surface icons. */
  icon: string;

  /** Hairline border on surfaces. */
  border: string;
  /** A stronger border for emphasis / selected outlines. */
  borderStrong: string;

  /** Brand accent (tab active, links, filter accents). */
  tint: string;
  /** Filled CTA background (e.g. Navigate / Apply). */
  accent: string;
  /** Text/icon on top of `accent`. */
  onAccent: string;

  tabIconDefault: string;
  tabIconSelected: string;
  /** Tab bar background. */
  tabBar: string;

  /** Floating map-overlay chrome (pills, FABs, legend) background. */
  chrome: string;
  /** Border for map-overlay chrome. */
  chromeBorder: string;
  /** Text on map-overlay chrome. */
  chromeText: string;
  /** Icon color on map-overlay chrome. */
  chromeIcon: string;

  /** Bottom-sheet drag handle. */
  handle: string;
  /** Text-input background inside sheets / cards. */
  inputBg: string;
  /** Placeholder text color. */
  placeholder: string;

  danger: string;
  /** Charger status dots. */
  statusAvailable: string;
  statusInUse: string;
  statusOffline: string;
  statusUnknown: string;
};

export const Colors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    background: '#F4F6F5',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    surfaceSunken: '#EDF0EE',

    text: '#0B1512',
    textMuted: '#5B6560',
    icon: '#5B6560',

    border: 'rgba(11,21,18,0.10)',
    borderStrong: 'rgba(11,21,18,0.18)',

    tint: brandGreenDark,
    accent: brandGreenDark,
    onAccent: '#FFFFFF',

    tabIconDefault: '#8A938E',
    tabIconSelected: brandGreenDark,
    tabBar: '#FFFFFF',

    chrome: 'rgba(255,255,255,0.94)',
    chromeBorder: 'rgba(11,21,18,0.10)',
    chromeText: '#0B1512',
    chromeIcon: '#0B1512',

    handle: 'rgba(11,21,18,0.22)',
    inputBg: '#EDF0EE',
    placeholder: 'rgba(11,21,18,0.35)',

    danger: brandRed,
    statusAvailable,
    statusInUse,
    statusOffline,
    statusUnknown,
  },
  dark: {
    background: '#0B0F0D',
    surface: '#151A17',
    surfaceElevated: '#1C2320',
    surfaceSunken: '#0E1210',

    text: '#ECEDEE',
    textMuted: '#9BA1A6',
    icon: '#9BA1A6',

    border: 'rgba(255,255,255,0.10)',
    borderStrong: 'rgba(255,255,255,0.18)',

    tint: brandGreenNeon,
    accent: brandGreenNeon,
    onAccent: '#07120B',

    tabIconDefault: '#9BA1A6',
    tabIconSelected: brandGreenNeon,
    tabBar: '#0E1310',

    chrome: 'rgba(18,20,19,0.92)',
    chromeBorder: 'rgba(255,255,255,0.12)',
    chromeText: '#ECEDEE',
    chromeIcon: '#ECEDEE',

    handle: 'rgba(255,255,255,0.25)',
    inputBg: 'rgba(255,255,255,0.06)',
    placeholder: 'rgba(255,255,255,0.35)',

    danger: brandRed,
    statusAvailable,
    statusInUse,
    statusOffline,
    statusUnknown,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
