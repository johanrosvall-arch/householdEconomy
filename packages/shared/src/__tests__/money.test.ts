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
