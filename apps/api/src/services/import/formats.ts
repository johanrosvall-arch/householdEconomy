import type { ColumnMapping } from '@household/shared';
import { parseAmount, parseDate } from '@household/shared';

/**
 * Known statement layouts.
 *
 * Swedish banks all export "date, text, amount, balance" but disagree on
 * column names, delimiters, sign conventions and encoding. Rather than force
 * the user through a mapping wizard every time, we fingerprint the header row
 * against this table and pre-fill the mapping — which the user can still
 * override before committing the import.
 *
 * `signature` lists headers that must all be present. Matching is done on
 * ASCII-folded, lowercased headers so a file mangled from ISO-8859-1 to UTF-8
 * (`Bokf?ringsdatum`) still matches.
 */

export interface BankFormat {
  id: string;
  label: string;
  signature: string[];
  mapping: ColumnMapping;
  notes?: string;
}

const emptyMapping: ColumnMapping = {
  date: null,
  valueDate: null,
  description: null,
  amount: null,
  debit: null,
  credit: null,
  balance: null,
  currency: null,
  invertAmount: false,
};

function mapping(partial: Partial<ColumnMapping>): ColumnMapping {
  return { ...emptyMapping, ...partial };
}

export const BANK_FORMATS: readonly BankFormat[] = [
  {
    id: 'handelsbanken',
    label: 'Handelsbanken',
    signature: ['reskontradatum', 'transaktionsdatum', 'text', 'belopp'],
    mapping: mapping({
      date: 'Reskontradatum',
      valueDate: 'Transaktionsdatum',
      description: 'Text',
      amount: 'Belopp',
      balance: 'Saldo',
    }),
  },
  {
    id: 'handelsbanken-alt',
    label: 'Handelsbanken (bokföringsdatum)',
    signature: ['bokforingsdatum', 'transaktionsdatum', 'text', 'belopp'],
    mapping: mapping({
      date: 'Bokföringsdatum',
      valueDate: 'Transaktionsdatum',
      description: 'Text',
      amount: 'Belopp',
      balance: 'Saldo',
    }),
  },
  {
    id: 'lansforsakringar',
    label: 'Länsförsäkringar Bank',
    signature: ['bokforingsdag', 'text', 'belopp', 'saldo'],
    mapping: mapping({
      date: 'Bokföringsdag',
      description: 'Text',
      amount: 'Belopp',
      balance: 'Saldo',
    }),
  },
  {
    id: 'lansforsakringar-simple',
    label: 'Länsförsäkringar Bank (enkel)',
    signature: ['datum', 'text', 'belopp', 'saldo'],
    mapping: mapping({
      date: 'Datum',
      description: 'Text',
      amount: 'Belopp',
      balance: 'Saldo',
    }),
  },
  {
    id: 'swedbank',
    label: 'Swedbank',
    signature: ['bokforingsdag', 'transaktionsdag', 'beskrivning', 'belopp'],
    mapping: mapping({
      date: 'Bokföringsdag',
      valueDate: 'Transaktionsdag',
      description: 'Beskrivning',
      amount: 'Belopp',
      balance: 'Bokfört saldo',
      currency: 'Valuta',
    }),
  },
  {
    id: 'seb',
    label: 'SEB',
    signature: ['bokforingsdatum', 'valutadatum', 'text', 'belopp'],
    mapping: mapping({
      date: 'Bokföringsdatum',
      valueDate: 'Valutadatum',
      description: 'Text',
      amount: 'Belopp',
      balance: 'Saldo',
    }),
  },
  {
    id: 'nordea',
    label: 'Nordea',
    signature: ['bokforingsdag', 'belopp', 'rubrik'],
    mapping: mapping({
      date: 'Bokföringsdag',
      description: 'Rubrik',
      amount: 'Belopp',
      balance: 'Saldo',
      currency: 'Valuta',
    }),
  },
  {
    id: 'ica-banken',
    label: 'ICA Banken',
    signature: ['datum', 'beskrivning', 'belopp', 'saldo'],
    mapping: mapping({
      date: 'Datum',
      description: 'Beskrivning',
      amount: 'Belopp',
      balance: 'Saldo',
    }),
  },
  {
    id: 'amex-se',
    label: 'American Express',
    signature: ['datum', 'beskrivning', 'belopp'],
    // Amex statements list a purchase as a positive charge. Inverting turns
    // them into the negative-is-spend convention used everywhere else.
    mapping: mapping({
      date: 'Datum',
      description: 'Beskrivning',
      amount: 'Belopp',
      invertAmount: true,
    }),
    notes: 'Charges are listed positive on Amex statements and are inverted on import.',
  },
  {
    id: 'amex-en',
    label: 'American Express (English)',
    signature: ['date', 'description', 'amount'],
    mapping: mapping({
      date: 'Date',
      description: 'Description',
      amount: 'Amount',
      invertAmount: true,
    }),
    notes: 'Charges are listed positive on Amex statements and are inverted on import.',
  },
  {
    id: 'klarna',
    label: 'Klarna',
    signature: ['datum', 'butik', 'belopp'],
    mapping: mapping({
      date: 'Datum',
      description: 'Butik',
      amount: 'Belopp',
      currency: 'Valuta',
      invertAmount: true,
    }),
    notes: 'Klarna lists purchases positive; inverted on import.',
  },
  {
    id: 'klarna-en',
    label: 'Klarna (English)',
    signature: ['purchase date', 'store', 'amount'],
    mapping: mapping({
      date: 'Purchase date',
      description: 'Store',
      amount: 'Amount',
      currency: 'Currency',
      invertAmount: true,
    }),
  },
  {
    id: 'revolut',
    label: 'Revolut',
    signature: ['started date', 'description', 'amount'],
    mapping: mapping({
      date: 'Started Date',
      valueDate: 'Completed Date',
      description: 'Description',
      amount: 'Amount',
      balance: 'Balance',
      currency: 'Currency',
    }),
  },
  {
    id: 'generic-debit-credit',
    label: 'Generic (separate debit/credit columns)',
    signature: ['datum', 'text', 'uttag', 'insattning'],
    mapping: mapping({
      date: 'Datum',
      description: 'Text',
      debit: 'Uttag',
      credit: 'Insättning',
      balance: 'Saldo',
    }),
  },
];

/** Lowercase, strip diacritics and non-alphanumerics, collapse whitespace. */
export function foldHeader(header: string): string {
  return String(header ?? '')
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface FormatDetection {
  format: BankFormat | null;
  mapping: ColumnMapping;
  /** 'signature' when a known bank matched, 'inferred' when we guessed. */
  method: 'signature' | 'inferred';
}

/**
 * Picks a format for the given header row. Falls back to content-based
 * inference, which is what makes "upload any CSV" work for banks not in the
 * table above.
 */
export function detectFormat(headers: string[], sampleRows: string[][] = []): FormatDetection {
  const folded = headers.map(foldHeader);

  let best: { format: BankFormat; score: number } | null = null;
  for (const format of BANK_FORMATS) {
    const hits = format.signature.filter((sig) => folded.includes(sig)).length;
    if (hits !== format.signature.length) continue;
    // Prefer the format with the most specific signature, so Swedbank's
    // 4-column fingerprint wins over a generic 3-column one.
    const score = format.signature.length;
    if (!best || score > best.score) best = { format, score };
  }

  if (best) {
    return {
      format: best.format,
      mapping: resolveMappingToActualHeaders(best.format.mapping, headers),
      method: 'signature',
    };
  }

  return { format: null, mapping: inferMapping(headers, sampleRows), method: 'inferred' };
}

/**
 * A format's mapping names headers canonically ("Bokföringsdatum"). The real
 * file may spell them differently in case or accents, so rewrite the mapping
 * to the exact strings present in the file — the parser looks columns up by
 * literal header.
 */
function resolveMappingToActualHeaders(source: ColumnMapping, headers: string[]): ColumnMapping {
  const byFolded = new Map<string, string>();
  for (const h of headers) byFolded.set(foldHeader(h), h);

  const resolve = (value: string | null | undefined): string | null => {
    if (!value) return null;
    return byFolded.get(foldHeader(value)) ?? null;
  };

  return {
    date: resolve(source.date),
    valueDate: resolve(source.valueDate),
    description: resolve(source.description),
    amount: resolve(source.amount),
    debit: resolve(source.debit),
    credit: resolve(source.credit),
    balance: resolve(source.balance),
    currency: resolve(source.currency),
    invertAmount: source.invertAmount,
  };
}

/** Header keywords that hint at a role, checked before falling back to content. */
const HEADER_HINTS: Record<keyof Omit<ColumnMapping, 'invertAmount'>, string[]> = {
  date: ['bokforingsdatum', 'bokforingsdag', 'reskontradatum', 'datum', 'date', 'transaktionsdag', 'purchase date', 'started date'],
  valueDate: ['valutadatum', 'valutadag', 'transaktionsdatum', 'completed date', 'value date'],
  description: ['text', 'beskrivning', 'rubrik', 'description', 'narrative', 'butik', 'store', 'mottagare', 'meddelande', 'referens'],
  amount: ['belopp', 'amount', 'summa', 'transaktionsbelopp'],
  debit: ['uttag', 'debet', 'debit', 'utbetalning'],
  credit: ['insattning', 'kredit', 'credit', 'inbetalning'],
  balance: ['saldo', 'balance', 'bokfort saldo', 'kontosaldo'],
  currency: ['valuta', 'currency'],
};

/**
 * Content-based inference for unknown layouts. Scores every column on how
 * many of its sample values parse as a date / an amount, and takes the best
 * candidate for each role. Header keywords act as a strong prior but content
 * gets the final say — a column headed "Datum" full of text is not the date.
 */
export function inferMapping(headers: string[], sampleRows: string[][]): ColumnMapping {
  const folded = headers.map(foldHeader);
  const columnCount = headers.length;

  const dateScores: number[] = new Array(columnCount).fill(0);
  const amountScores: number[] = new Array(columnCount).fill(0);
  const textScores: number[] = new Array(columnCount).fill(0);

  const rows = sampleRows.slice(0, 50);
  for (const row of rows) {
    for (let i = 0; i < columnCount; i++) {
      const value = (row[i] ?? '').trim();
      if (value === '') continue;
      if (parseDate(value)) dateScores[i]! += 1;
      if (parseAmount(value) !== null) amountScores[i]! += 1;
      if (/[a-zåäöA-ZÅÄÖ]{3,}/.test(value)) textScores[i]! += 1;
    }
  }

  const sampleCount = Math.max(rows.length, 1);
  const hintBonus = (role: keyof typeof HEADER_HINTS, index: number): number => {
    const header = folded[index] ?? '';
    return HEADER_HINTS[role].some((hint) => header === hint || header.includes(hint)) ? 0.5 : 0;
  };

  const pick = (
    role: keyof typeof HEADER_HINTS,
    scores: number[],
    exclude: Set<number>,
    threshold = 0.6,
  ): number | null => {
    let bestIndex: number | null = null;
    let bestScore = -1;
    for (let i = 0; i < columnCount; i++) {
      if (exclude.has(i)) continue;
      const score = scores[i]! / sampleCount + hintBonus(role, i);
      if (score > bestScore && scores[i]! / sampleCount >= threshold) {
        bestScore = score;
        bestIndex = i;
      }
    }
    return bestIndex;
  };

  const used = new Set<number>();

  const dateIndex = pick('date', dateScores, used);
  if (dateIndex != null) used.add(dateIndex);

  const valueDateIndex = pick('valueDate', dateScores, used);
  if (valueDateIndex != null) used.add(valueDateIndex);

  // Balance columns also parse as amounts. Identify the balance first via its
  // header so it does not get claimed as the transaction amount.
  let balanceIndex: number | null = null;
  for (let i = 0; i < columnCount; i++) {
    if (used.has(i)) continue;
    const header = folded[i] ?? '';
    if (HEADER_HINTS.balance.some((hint) => header.includes(hint))) {
      balanceIndex = i;
      break;
    }
  }
  if (balanceIndex != null) used.add(balanceIndex);

  // Separate debit/credit columns, if the headers say so.
  let debitIndex: number | null = null;
  let creditIndex: number | null = null;
  for (let i = 0; i < columnCount; i++) {
    if (used.has(i)) continue;
    const header = folded[i] ?? '';
    if (debitIndex == null && HEADER_HINTS.debit.some((h) => header.includes(h))) debitIndex = i;
    else if (creditIndex == null && HEADER_HINTS.credit.some((h) => header.includes(h))) creditIndex = i;
  }
  if (debitIndex != null && creditIndex != null) {
    used.add(debitIndex);
    used.add(creditIndex);
  } else {
    debitIndex = null;
    creditIndex = null;
  }

  const amountIndex = debitIndex != null ? null : pick('amount', amountScores, used);
  if (amountIndex != null) used.add(amountIndex);

  const descriptionIndex = pick('description', textScores, used, 0.3);

  let currencyIndex: number | null = null;
  for (let i = 0; i < columnCount; i++) {
    if (used.has(i)) continue;
    const header = folded[i] ?? '';
    if (HEADER_HINTS.currency.some((hint) => header.includes(hint))) {
      currencyIndex = i;
      break;
    }
  }

  const nameAt = (index: number | null): string | null =>
    index == null ? null : (headers[index] ?? null);

  return {
    date: nameAt(dateIndex),
    valueDate: nameAt(valueDateIndex),
    description: nameAt(descriptionIndex),
    amount: nameAt(amountIndex),
    debit: nameAt(debitIndex),
    credit: nameAt(creditIndex),
    balance: nameAt(balanceIndex),
    currency: nameAt(currencyIndex),
    invertAmount: false,
  };
}
