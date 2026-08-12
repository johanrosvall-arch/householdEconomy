import { describe, it, expect } from 'vitest';
import {
  parseDate,
  addMonths,
  periodBounds,
  daysInPeriod,
  periodProgress,
  recentPeriods,
  toPeriodKey,
} from '../date.js';

describe('parseDate', () => {
  it('parses ISO dates', () => {
    expect(parseDate('2024-05-17')).toBe('2024-05-17');
    expect(parseDate('2024/05/17')).toBe('2024-05-17');
    expect(parseDate('2024.05.17')).toBe('2024-05-17');
  });

  it('parses compact dates', () => {
    expect(parseDate('20240517')).toBe('2024-05-17');
  });

  it('parses day-first dates', () => {
    expect(parseDate('17/05/2024')).toBe('2024-05-17');
    expect(parseDate('17.05.2024')).toBe('2024-05-17');
    expect(parseDate('17-05-24')).toBe('2024-05-17');
  });

  it('parses Swedish month names', () => {
    expect(parseDate('17 maj 2024')).toBe('2024-05-17');
    expect(parseDate('3 december 2023')).toBe('2023-12-03');
  });

  it('ignores a trailing time component', () => {
    expect(parseDate('2024-05-17 14:32:01')).toBe('2024-05-17');
  });

  it('rejects impossible dates instead of rolling them over', () => {
    expect(parseDate('2024-02-31')).toBeNull();
    expect(parseDate('2023-02-29')).toBeNull();
  });

  it('accepts a real leap day', () => {
    expect(parseDate('2024-02-29')).toBe('2024-02-29');
  });

  it('returns null for non-dates', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('Datum')).toBeNull();
  });
});

describe('period maths', () => {
  it('adds and subtracts months across year boundaries', () => {
    expect(addMonths('2024-01', -1)).toBe('2023-12');
    expect(addMonths('2024-12', 1)).toBe('2025-01');
    expect(addMonths('2024-05', 12)).toBe('2025-05');
    expect(addMonths('2024-05', -17)).toBe('2022-12');
  });

  it('computes inclusive bounds', () => {
    expect(periodBounds('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(periodBounds('2023-02')).toEqual({ start: '2023-02-01', end: '2023-02-28' });
    expect(periodBounds('2024-04')).toEqual({ start: '2024-04-01', end: '2024-04-30' });
  });

  it('counts days in a period', () => {
    expect(daysInPeriod('2024-02')).toBe(29);
    expect(daysInPeriod('2024-12')).toBe(31);
  });

  it('derives a period key from a date', () => {
    expect(toPeriodKey('2024-05-17')).toBe('2024-05');
  });

  it('reports progress through a period', () => {
    expect(periodProgress('2024-04', new Date('2024-04-15T12:00:00Z'))).toBeCloseTo(0.5, 1);
    expect(periodProgress('2024-03', new Date('2024-04-15T12:00:00Z'))).toBe(1);
    expect(periodProgress('2024-05', new Date('2024-04-15T12:00:00Z'))).toBe(0);
  });

  it('lists recent periods oldest first', () => {
    expect(recentPeriods('2024-03', 4)).toEqual(['2023-12', '2024-01', '2024-02', '2024-03']);
  });
});
