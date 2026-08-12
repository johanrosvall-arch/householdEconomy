import { describe, it, expect } from 'vitest';
import { parseAmount, formatMoney, splitEvenly, toMinorUnits, toMajorUnits } from '../money.js';

describe('parseAmount', () => {
  it('parses plain decimals', () => {
    expect(parseAmount('1234.56')).toBe(123456);
    expect(parseAmount('0.05')).toBe(5);
    expect(parseAmount('42')).toBe(4200);
  });

  it('parses Swedish formatting with comma decimals and space grouping', () => {
    expect(parseAmount('1 234,56')).toBe(123456);
    expect(parseAmount('12 345,00')).toBe(1234500);
    expect(parseAmount('-1 234,56')).toBe(-123456);
  });

  it('handles non-breaking and narrow-no-break spaces from Excel', () => {
    expect(parseAmount('1\u00a0234,56')).toBe(123456);
    expect(parseAmount('1\u202f234,56')).toBe(123456);
  });

  it('parses dot-grouped continental format', () => {
    expect(parseAmount('1.234,56')).toBe(123456);
    expect(parseAmount('1.234.567,89')).toBe(123456789);
  });

  it('parses anglo format with comma grouping', () => {
    expect(parseAmount('1,234.56')).toBe(123456);
  });

  it('treats a lone trailing 3-digit group as thousands, not decimals', () => {
    // Swedish exports write "1,234" for 1234 kr far more often than 1.234 kr.
    expect(parseAmount('1,234')).toBe(123400);
    expect(parseAmount('12.345')).toBe(1234500);
  });

  it('strips currency labels', () => {
    expect(parseAmount('1 234,56 kr')).toBe(123456);
    expect(parseAmount('SEK 99,00')).toBe(9900);
    expect(parseAmount('49,00 EUR', 'EUR')).toBe(4900);
  });

  it('reads accounting-style parentheses as negative', () => {
    expect(parseAmount('(1 234,56)')).toBe(-123456);
  });

  it('accepts the unicode minus sign', () => {
    expect(parseAmount('−500,00')).toBe(-50000);
  });

  it('accepts an explicit plus', () => {
    expect(parseAmount('+2 500,00')).toBe(250000);
  });

  it('returns null for things that are not amounts', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount('-')).toBeNull();
    expect(parseAmount('Saldo')).toBeNull();
    expect(parseAmount('n/a')).toBeNull();
  });

  it('rounds to the nearest öre rather than truncating', () => {
    expect(parseAmount('0.005')).toBe(1);
    expect(parseAmount('0.004')).toBe(0);
  });

  it('reads a bare 3-decimal group as thousands, per the grouping rule', () => {
    // Deliberate: "1.005" in a continental-format export is 1 005 kr, not one
    // krona and half an öre. Bank statements are always 2 decimals, so the
    // thousands reading is the useful one. A leading zero opts out (see above).
    expect(parseAmount('1.005')).toBe(100500);
    expect(parseAmount('0.005')).toBe(1);
  });

  it('round-trips every öre value in a range without drift', () => {
    const wrong: number[] = [];
    for (let minor = 0; minor < 2000; minor++) {
      const major = (minor / 100).toFixed(2);
      if (parseAmount(major) !== minor) wrong.push(minor);
    }
    expect(wrong).toEqual([]);
  });
});

describe('minor/major conversion', () => {
  it('round-trips', () => {
    expect(toMinorUnits(1234.56)).toBe(123456);
    expect(toMajorUnits(123456)).toBe(1234.56);
  });

  it('avoids float drift on values that break naive multiplication', () => {
    expect(toMinorUnits(19.99)).toBe(1999);
    expect(toMinorUnits(1.005)).toBe(101);
  });

  /**
   * Regression guard for the original bug. `Math.round(1.005 * 100)` is 100,
   * not 101, because 1.005 is really 1.00499999999999989 as a double — so a
   * ledger built on float multiplication drops an öre at magnitudes you cannot
   * predict. Conversion shifts the decimal point textually instead.
   *
   * `x.xx5` is exactly where the two approaches diverge, so sweep the boundary
   * rather than spot-checking two values.
   */
  it('rounds the half-öre boundary exactly, at every magnitude', () => {
    const wrong: string[] = [];
    for (let kronor = 0; kronor < 1000; kronor++) {
      // Number() of the literal, so each case is the same double you would get
      // from writing `1.005` in source.
      const value = Number(`${kronor}.005`);
      const expected = kronor * 100 + 1;
      if (toMinorUnits(value) !== expected) wrong.push(`${kronor}.005`);
    }
    expect(wrong).toEqual([]);
  });

  it('converts every öre value in a range without drift', () => {
    const wrong: number[] = [];
    for (let minor = 0; minor < 2000; minor++) {
      if (toMinorUnits(minor / 100) !== minor) wrong.push(minor);
    }
    expect(wrong).toEqual([]);
  });
});

describe('formatMoney', () => {
  it('formats SEK in Swedish locale', () => {
    // Intl uses NBSP-family separators; normalise before comparing.
    const out = formatMoney(123456).replace(/[\s\u00a0\u202f]/g, ' ');
    expect(out).toContain('1 234,56');
    expect(out).toContain('kr');
  });

  it('adds an explicit plus for income when asked', () => {
    expect(formatMoney(5000, 'SEK', { showSign: true }).startsWith('+')).toBe(true);
    expect(formatMoney(-5000, 'SEK', { showSign: true }).startsWith('+')).toBe(false);
  });
});

describe('splitEvenly', () => {
  it('splits without losing öre', () => {
    const parts = splitEvenly(10000, 3);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it('preserves sign for expenses', () => {
    const parts = splitEvenly(-1000, 4);
    expect(parts).toEqual([-250, -250, -250, -250]);
  });

  it('rejects a non-positive split', () => {
    expect(() => splitEvenly(100, 0)).toThrow(RangeError);
  });
});
