/**
 * Money is represented everywhere as an integer number of minor units
 * (öre for SEK, cents for EUR/USD). Never floats — 0.1 + 0.2 problems in a
 * ledger are unacceptable.
 *
 * Sign convention, matching how banks present a statement:
 *   negative = money left the account (expense)
 *   positive = money entered the account (income / refund)
 */

export type Currency = 'SEK' | 'EUR' | 'USD' | 'NOK' | 'DKK' | 'GBP';

export interface Money {
  amount: number; // minor units, integer
  currency: Currency;
}

const MINOR_UNIT_EXPONENT: Record<Currency, number> = {
  SEK: 2,
  EUR: 2,
  USD: 2,
  NOK: 2,
  DKK: 2,
  GBP: 2,
};

export function minorUnitFactor(currency: Currency): number {
  return 10 ** MINOR_UNIT_EXPONENT[currency];
}

export function money(amount: number, currency: Currency = 'SEK'): Money {
  if (!Number.isInteger(amount)) {
    throw new TypeError(`Money amount must be an integer in minor units, got ${amount}`);
  }
  return { amount, currency };
}

/**
 * Converts a decimal string to minor units without ever multiplying a float.
 *
 * `Math.round(1.005 * 100)` is 100, not 101, because 1.005 is really
 * 1.00499999999999989 as a double. Shifting the decimal point textually keeps
 * the conversion exact for every value a statement can contain.
 *
 * Expects a plain unsigned decimal (`\d+(\.\d+)?`); the caller strips signs
 * and separators first.
 */
function decimalStringToMinor(decimal: string, exponent: number): number | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(decimal);
  if (!match) return null;

  const intPart = match[1]!;
  const fracPart = match[2] ?? '';

  // One digit beyond the minor unit decides the rounding.
  const padded = (fracPart + '0'.repeat(exponent + 1)).slice(0, exponent + 1);
  const scaled = Number(intPart + padded.slice(0, exponent));
  if (!Number.isSafeInteger(scaled)) return null;

  const roundDigit = Number(padded[exponent] ?? '0');
  return roundDigit >= 5 ? scaled + 1 : scaled;
}

/** 1234.56 -> 123456 */
export function toMinorUnits(major: number, currency: Currency = 'SEK'): number {
  const exponent = MINOR_UNIT_EXPONENT[currency];
  const sign = major < 0 ? -1 : 1;
  const text = Math.abs(major).toString();

  // Exponential notation (very large or very small) cannot be shifted
  // textually; those magnitudes are outside any real statement anyway.
  if (!text.includes('e') && !text.includes('E')) {
    const exact = decimalStringToMinor(text, exponent);
    if (exact != null) return sign * exact;
  }
  return Math.round(major * minorUnitFactor(currency));
}

/** 123456 -> 1234.56 */
export function toMajorUnits(minor: number, currency: Currency = 'SEK'): number {
  return minor / minorUnitFactor(currency);
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function sumMinor(values: readonly number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

export function negate(m: Money): Money {
  return { amount: -m.amount, currency: m.currency };
}

export function absMinor(amount: number): number {
  return Math.abs(amount);
}

export function isExpense(amount: number): boolean {
  return amount < 0;
}

export function isIncome(amount: number): boolean {
  return amount > 0;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}. Convert before combining.`);
  }
}

/**
 * Parses an amount as written by Swedish banks in CSV exports.
 * Handles: "1 234,56", "1.234,56", "-1234.56", "1 234,56 kr", "(1 234,56)",
 * "−1 234,56" (U+2212 minus), and non-breaking / narrow-no-break spaces.
 *
 * Returns minor units, or null when the string is not an amount at all.
 */
export function parseAmount(raw: string, currency: Currency = 'SEK'): number | null {
  if (raw == null) return null;

  let s = String(raw).trim();
  if (s === '' || s === '-' || s === '–') return null;

  // Accounting negatives: (1 234,56)
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  // Strip currency labels and any whitespace used as a thousands separator,
  // including NBSP (U+00A0) and narrow NBSP (U+202F) which Excel loves to emit.
  s = s
    .replace(/−/g, '-') // unicode minus
    .replace(/(kr|SEK|EUR|USD|NOK|DKK|GBP|€|\$|£)/gi, '')
    .replace(/[\s\u00a0\u202f']/g, '')
    .trim();

  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  if (s === '' || !/^[\d.,]+$/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  let normalized: string;
  if (lastComma === -1 && lastDot === -1) {
    normalized = s;
  } else {
    // Whichever separator comes last is the decimal separator. The other one,
    // wherever it appears, is grouping. "1.234,56" -> comma; "1,234.56" -> dot.
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const groupSep = decimalSep === ',' ? '.' : ',';
    const decimalIndex = decimalSep === ',' ? lastComma : lastDot;
    const decimals = s.slice(decimalIndex + 1);

    // A trailing group of exactly 3 digits with no other separator is ambiguous
    // ("1,234"). Swedish exports write thousands far more often than a 3-decimal
    // amount, so treat it as grouping — unless the leading part is a bare zero
    // or zero-padded, since "0,005" is five öre and never five thousand.
    const leading = s.slice(0, decimalIndex);
    const isGrouping =
      decimals.length === 3 && !leading.includes(groupSep) && !leading.startsWith('0');
    normalized = isGrouping
      ? s.split(/[.,]/).join('')
      : s.slice(0, decimalIndex).split(groupSep).join('') + '.' + decimals;
  }

  const minor = decimalStringToMinor(normalized, MINOR_UNIT_EXPONENT[currency]);
  if (minor == null) return null;
  return negative ? -minor : minor;
}

/**
 * Formats minor units for display. Uses sv-SE grouping by default, which is
 * what the app ships with — "1 234,56 kr".
 */
export function formatMoney(
  minor: number,
  currency: Currency = 'SEK',
  options: { locale?: string; showSign?: boolean; compact?: boolean } = {},
): string {
  const { locale = 'sv-SE', showSign = false, compact = false } = options;

  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
    notation: compact ? 'compact' : 'standard',
  }).format(toMajorUnits(minor, currency));

  if (showSign && minor > 0) return `+${formatted}`;
  return formatted;
}

/** Splits an amount across n ways without losing öre to rounding. */
export function splitEvenly(minor: number, ways: number): number[] {
  if (ways < 1 || !Number.isInteger(ways)) {
    throw new RangeError(`ways must be a positive integer, got ${ways}`);
  }
  const sign = minor < 0 ? -1 : 1;
  const total = Math.abs(minor);
  const base = Math.floor(total / ways);
  const remainder = total - base * ways;
  return Array.from({ length: ways }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}
