import type { TextStyle } from 'react-native';

/**
 * Tabular figures, so columns of amounts line up digit for digit.
 *
 * Declared outside the `as const` object below: `as const` would make
 * `fontVariant` a readonly tuple, and React Native's TextStyle requires a
 * mutable array.
 */
const numericFont: TextStyle = {
  fontVariant: ['tabular-nums'],
};

/**
 * Design tokens. A single dark palette — a money app is read at a glance, and
 * the numbers need to stay legible against a calm background rather than
 * competing with it.
 */
export const theme = {
  color: {
    background: '#0B1220',
    surface: '#141C2B',
    surfaceRaised: '#1C2637',
    border: '#26324A',

    text: '#F2F5FA',
    textMuted: '#95A2B8',
    textFaint: '#63718A',

    /** Money in. */
    positive: '#37D67A',
    /** Money out. Deliberately not alarm-red: most spending is normal. */
    negative: '#F2F5FA',
    /** Over budget / needs attention. */
    danger: '#FF6B6B',
    warning: '#FFA94D',
    accent: '#4C6EF5',
    accentSoft: '#2A3A6B',
  },
  space: (n: number) => n * 4,
  radius: {
    sm: 8,
    md: 12,
    lg: 20,
    pill: 999,
  },
  font: {
    numeric: numericFont,
    size: {
      xs: 11,
      sm: 13,
      md: 15,
      lg: 18,
      xl: 24,
      xxl: 34,
    },
  },
} as const;

export type Theme = typeof theme;
