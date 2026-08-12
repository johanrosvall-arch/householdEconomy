/**
 * Date helpers. Everything budget-related works on "period keys" — `YYYY-MM`
 * strings — rather than Date objects, so a budget month is unambiguous and
 * timezone-independent. Transaction dates are stored as `YYYY-MM-DD`.
 */

export type PeriodKey = string; // 'YYYY-MM'
export type DateKey = string; // 'YYYY-MM-DD'

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isPeriodKey(value: string): value is PeriodKey {
  return PERIOD_RE.test(value);
}

export function isDateKey(value: string): value is DateKey {
  return DATE_RE.test(value);
}

export function toDateKey(d: Date): DateKey {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function toPeriodKey(value: Date | DateKey): PeriodKey {
  if (typeof value === 'string') return value.slice(0, 7);
  return toDateKey(value).slice(0, 7);
}

export function currentPeriod(now: Date = new Date()): PeriodKey {
  return toPeriodKey(now);
}

export function addMonths(period: PeriodKey, delta: number): PeriodKey {
  const [yStr, mStr] = period.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const zeroBased = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(zeroBased / 12);
  const newMonth = (zeroBased % 12) + 1;
  return `${String(newYear).padStart(4, '0')}-${String(newMonth).padStart(2, '0')}`;
}

/** Inclusive first/last day of a period, as date keys. */
export function periodBounds(period: PeriodKey): { start: DateKey; end: DateKey } {
  const [yStr, mStr] = period.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${period}-01`,
    end: `${period}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function daysInPeriod(period: PeriodKey): number {
  const [yStr, mStr] = period.split('-');
  return new Date(Date.UTC(Number(yStr), Number(mStr), 0)).getUTCDate();
}

/**
 * How far through the period we are, 0..1. Used to pro-rate a budget so
 * "spent 60% on day 5" reads as over-pace rather than fine.
 */
export function periodProgress(period: PeriodKey, now: Date = new Date()): number {
  const nowPeriod = toPeriodKey(now);
  if (nowPeriod > period) return 1;
  if (nowPeriod < period) return 0;
  return now.getUTCDate() / daysInPeriod(period);
}

/** The last `count` periods ending at `period`, oldest first. */
export function recentPeriods(period: PeriodKey, count: number): PeriodKey[] {
  return Array.from({ length: count }, (_, i) => addMonths(period, i - (count - 1)));
}

/**
 * Parses the date formats that turn up in Swedish bank exports:
 * 2024-05-17, 2024/05/17, 17/05/2024, 17.05.2024, 20240517, 17 maj 2024.
 * Returns a date key, or null if unparseable.
 */
const SV_MONTHS: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mar: 3, mars: 3,
  apr: 4, april: 4,
  maj: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  aug: 8, augusti: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export function parseDate(raw: string): DateKey | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;

  // ISO-ish: 2024-05-17 / 2024/05/17 / 2024.05.17
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return buildDate(Number(m[1]), Number(m[2]), Number(m[3]));

  // Compact: 20240517
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return buildDate(Number(m[1]), Number(m[2]), Number(m[3]));

  // Day-first: 17/05/2024, 17.05.2024, 17-05-24
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const year = Number(m[3]);
    return buildDate(year < 100 ? 2000 + year : year, Number(m[2]), Number(m[1]));
  }

  // Swedish long form: "17 maj 2024" / "17 maj"
  m = /^(\d{1,2})\s+([a-zåäö]+)\.?\s*(\d{4})?$/i.exec(s);
  if (m) {
    const month = SV_MONTHS[m[2]!.toLowerCase()];
    if (month) {
      const year = m[3] ? Number(m[3]) : new Date().getUTCFullYear();
      return buildDate(year, month, Number(m[1]));
    }
  }

  return null;
}

function buildDate(year: number, month: number, day: number): DateKey | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Rejects impossible dates that JS would roll over (e.g. 2024-02-31).
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return toDateKey(d);
}
