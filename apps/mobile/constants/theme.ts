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
/**
 * The light scheme's *interactive* green, distinct from `brandGreenDark`.
 *
 * `tint` and `accent` used to be the same near-black green in light mode, which meant a link, a
 * "Reset" and a piece of bold body text were the same colour — nothing text-based looked
 * tappable. This sits at 5.3:1 on white and 4.8:1 on the app background, and still carries white
 * text at 5.3:1 when used as a fill, so it works as both ink and paint.
 */
const brandGreenMid = '#0F7A4A';
const brandGreenNeon = '#2FE28A';
const brandRed = '#E53935';

// Charger status — shared across both schemes to match the marker images. These values are not
// free: `scripts/gen-markers.cjs` bakes them into the marker PNGs, so a dot rendered from a token
// and a dot rendered from a pin must agree. It folds unknown into the offline grey, and so do we.
const statusAvailable = '#2FE28A';
const statusInUse = '#F7B84B';
const statusOffline = '#8A9099';
const statusUnknown = '#8A9099';

/**
 * Ink for things drawn *on the map* rather than on a surface.
 *
 * Map tiles do not follow the app's theme the way a card does — the route's start and end pins
 * have to read against Yandex's own light and dark tiles, so they are fixed rather than tokenized,
 * in the same spirit as the status colours above.
 */
export const MapInk = { ink: '#0B1512', paper: '#FFFFFF' } as const;

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
  /** Drop shadow for floating map chrome — a dark shadow on light, a lighter glow on dark, so
   * FABs/pills lift off the map in both themes. A CSS-style `boxShadow` string (RN new arch). */
  chromeShadow: string;

  /** Bottom-sheet drag handle. */
  handle: string;
  /** Text-input background inside sheets / cards. */
  inputBg: string;
  /** Placeholder text color. */
  placeholder: string;

  /** Something is wrong and blocks the user: a trip the car cannot make, a required field. */
  danger: string;
  /**
   * Caution: correct behaviour under a stated limitation — an estimated route, a relaxed filter,
   * a saved plan. Deliberately a separate token from `statusInUse`, which happens to be the same
   * amber today but means one specific thing: a charger is occupied.
   */
  warning: string;
  /** Charger status dots. */
  statusAvailable: string;
  statusInUse: string;
  statusOffline: string;
  statusUnknown: string;
};

/** Charger status → its dot colour, so the four call sites cannot drift apart again. */
export function statusColor(
  status: 'available' | 'in_use' | 'busy' | 'offline' | 'unknown' | null | undefined,
  c: ThemeColors
): string {
  switch (status) {
    case 'available':
      return c.statusAvailable;
    case 'in_use':
    case 'busy':
      return c.statusInUse;
    case 'offline':
      return c.statusOffline;
    default:
      return c.statusUnknown;
  }
}

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

    // tint = the interactive green (links, icons, selected states, the route line);
    // accent = the filled-CTA green. They differ only in the light scheme.
    tint: brandGreenMid,
    accent: brandGreenDark,
    onAccent: '#FFFFFF',

    tabIconDefault: '#8A938E',
    tabIconSelected: brandGreenMid,
    tabBar: '#FFFFFF',

    chrome: 'rgba(255,255,255,0.94)',
    chromeBorder: 'rgba(11,21,18,0.10)',
    chromeText: '#0B1512',
    chromeIcon: '#0B1512',
    // Light theme → a real, darker drop shadow against the bright map.
    chromeShadow: '0px 6px 16px rgba(11,21,18,0.20)',

    handle: 'rgba(11,21,18,0.22)',
    inputBg: '#EDF0EE',
    placeholder: 'rgba(11,21,18,0.35)',

    danger: brandRed,
    warning: statusInUse,
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
    // Dark theme → a dark shadow is invisible on the dark map, so use a lighter glow to lift chrome.
    chromeShadow: '0px 4px 18px rgba(0,0,0,0.55), 0px 0px 10px rgba(255,255,255,0.08)',

    handle: 'rgba(255,255,255,0.25)',
    inputBg: 'rgba(255,255,255,0.06)',
    placeholder: 'rgba(255,255,255,0.35)',

    danger: brandRed,
    warning: statusInUse,
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
