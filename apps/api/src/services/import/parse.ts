import { parse as parseCsvSync } from 'csv-parse/sync';
import iconv from 'iconv-lite';
import * as XLSX from 'xlsx';
import type { ColumnMapping, DateKey } from '@household/shared';
import { parseAmount, parseDate } from '@household/shared';
import { badRequest } from '../../lib/errors.js';

/**
 * Turning an arbitrary uploaded statement into rows.
 *
 * The hard parts in practice are not CSV syntax — they are encoding
 * (Handelsbanken still exports ISO-8859-1), delimiters (`;` is the Swedish
 * default because `,` is the decimal separator), and preamble junk rows above
 * the real header.
 */

export interface TabularFile {
  headers: string[];
  rows: string[][];
}

export interface ParsedRow {
  row: number;
  date: DateKey | null;
  valueDate: DateKey | null;
  amount: number | null;
  description: string;
  balanceAfter: number | null;
  currency: string | null;
  error?: string;
}

const MAX_ROWS = 50_000;

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/**
 * Decodes a CSV buffer to text. Honours a BOM when present; otherwise tries
 * UTF-8 and falls back to windows-1252 if the result contains replacement
 * characters, which is the reliable tell for a mis-decoded Latin-1 file.
 */
export function decodeBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return iconv.decode(buffer.subarray(2), 'utf-16le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return iconv.decode(buffer.subarray(2), 'utf-16be');
  }

  const utf8 = buffer.toString('utf8');
  if (utf8.includes('�')) {
    return iconv.decode(buffer, 'win1252');
  }
  return utf8;
}

/**
 * Picks the delimiter by counting candidates in the densest lines. Counting
 * on a single line is unreliable — a preamble line like "Kontoutdrag" has no
 * delimiters at all — so we take the modal count across the first few lines.
 */
export function detectDelimiter(text: string): string {
  const candidates = [';', ',', '\t', '|'];
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, 20);
  if (lines.length === 0) return ',';

  let best = ',';
  let bestScore = -1;
  for (const candidate of candidates) {
    const counts = lines.map((line) => countOutsideQuotes(line, candidate));
    const nonZero = counts.filter((c) => c > 0);
    if (nonZero.length === 0) continue;
    // Consistency matters more than raw frequency: the right delimiter yields
    // the same count on nearly every line.
    const modal = mode(nonZero);
    const consistency = nonZero.filter((c) => c === modal).length / nonZero.length;
    const score = modal * consistency;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, char: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === char && !inQuotes) count++;
  }
  return count;
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? 0;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = value;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Reading files
// ---------------------------------------------------------------------------

export function readCsv(buffer: Buffer): TabularFile {
  const text = decodeBuffer(buffer);
  const delimiter = detectDelimiter(text);

  let records: string[][];
  try {
    records = parseCsvSync(text, {
      delimiter,
      relaxColumnCount: true,
      relaxQuotes: true,
      skipEmptyLines: true,
      trim: true,
      bom: true,
    }) as string[][];
  } catch (err) {
    throw badRequest(`Could not read the CSV file: ${(err as Error).message}`);
  }

  return toTabular(records);
}

export function readSpreadsheet(buffer: Buffer): TabularFile {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false });
  } catch (err) {
    throw badRequest(`Could not read the spreadsheet: ${(err as Error).message}`);
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw badRequest('The spreadsheet has no sheets');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw badRequest('The spreadsheet has no readable sheet');

  const records = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: '',
    raw: false,
  });

  return toTabular(records.map((row) => row.map((cell) => String(cell ?? ''))));
}

export function readStatementFile(filename: string, buffer: Buffer): TabularFile {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.xlsm')) {
    return readSpreadsheet(buffer);
  }
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv')) {
    return readCsv(buffer);
  }
  // Unknown extension — sniff for the ZIP magic that marks an xlsx.
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return readSpreadsheet(buffer);
  }
  return readCsv(buffer);
}

/**
 * Finds the real header row and returns everything below it.
 *
 * Bank exports frequently open with account metadata ("Kontonummer: 1234-5",
 * a blank line, then the header). We take the first row that looks like a
 * header for a transaction table: several non-empty cells, and at least one
 * recognisable column word.
 */
function toTabular(records: string[][]): TabularFile {
  const rows = records.filter((r) => r.some((cell) => String(cell ?? '').trim() !== ''));
  if (rows.length === 0) throw badRequest('The file is empty');
  if (rows.length > MAX_ROWS) {
    throw badRequest(`The file has ${rows.length} rows, which is over the ${MAX_ROWS} row limit`);
  }

  const headerIndex = findHeaderRow(rows);
  const headerRow = rows[headerIndex]!;
  const width = headerRow.length;

  const headers = headerRow.map((h, i) => {
    const name = String(h ?? '').trim();
    return name === '' ? `Column ${i + 1}` : name;
  });

  const body = rows.slice(headerIndex + 1).map((row) => {
    const normalised = row.map((c) => String(c ?? '').trim());
    // Pad short rows so column indices stay aligned.
    while (normalised.length < width) normalised.push('');
    return normalised;
  });

  return { headers, rows: body };
}

const HEADER_WORDS = [
  'datum',
  'date',
  'belopp',
  'amount',
  'text',
  'beskrivning',
  'description',
  'saldo',
  'balance',
  'transaktion',
  'bokforing',
  'rubrik',
  'butik',
  'store',
];

function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const row = rows[i]!;
    const filled = row.filter((c) => String(c ?? '').trim() !== '').length;
    if (filled < 2) continue;

    const folded = row.map((c) =>
      String(c ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim(),
    );
    const hits = folded.filter((cell) => HEADER_WORDS.some((w) => cell.includes(w))).length;
    if (hits >= 2) return i;

    // A row where nothing parses as a date or amount, followed by a row where
    // something does, is a header even if we do not recognise the words.
    const next = rows[i + 1];
    if (next) {
      const headerLooksLikeData = row.some((c) => parseDate(c) || parseAmount(c) !== null);
      const nextLooksLikeData = next.some((c) => parseDate(c) || parseAmount(c) !== null);
      if (!headerLooksLikeData && nextLooksLikeData && filled >= 3) return i;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Applying a mapping
// ---------------------------------------------------------------------------

/**
 * Projects raw rows through a column mapping into parsed rows.
 *
 * Rows that fail to yield a date and an amount are kept with an `error` so the
 * preview can show the user exactly which line was rejected and why, rather
 * than silently dropping data from their ledger.
 */
export function applyMapping(file: TabularFile, mapping: ColumnMapping): ParsedRow[] {
  const index = (header: string | null | undefined): number =>
    header == null ? -1 : file.headers.indexOf(header);

  const dateIdx = index(mapping.date);
  const valueDateIdx = index(mapping.valueDate);
  const descIdx = index(mapping.description);
  const amountIdx = index(mapping.amount);
  const debitIdx = index(mapping.debit);
  const creditIdx = index(mapping.credit);
  const balanceIdx = index(mapping.balance);
  const currencyIdx = index(mapping.currency);

  const at = (row: string[], i: number): string => (i >= 0 ? (row[i] ?? '') : '');

  return file.rows.map((row, i) => {
    const rowNumber = i + 1;
    const rawDate = at(row, dateIdx);
    const date = rawDate ? parseDate(rawDate) : null;
    const valueDate = valueDateIdx >= 0 ? parseDate(at(row, valueDateIdx)) : null;

    const currency = currencyIdx >= 0 ? at(row, currencyIdx).toUpperCase() || null : null;
    const amount = readAmount(row, { amountIdx, debitIdx, creditIdx, at, invert: mapping.invertAmount });
    const balanceAfter = balanceIdx >= 0 ? parseAmount(at(row, balanceIdx)) : null;

    const description = descIdx >= 0 ? at(row, descIdx) : buildFallbackDescription(row, file.headers, [dateIdx, amountIdx, balanceIdx]);

    const parsed: ParsedRow = {
      row: rowNumber,
      date,
      valueDate,
      amount,
      description: description.trim(),
      balanceAfter,
      currency,
    };

    if (!date) parsed.error = rawDate ? `Could not read the date "${rawDate}"` : 'No date column value';
    else if (amount == null) parsed.error = 'Could not read an amount';
    else if (parsed.description === '') parsed.description = '(no description)';

    return parsed;
  });
}

function readAmount(
  row: string[],
  opts: {
    amountIdx: number;
    debitIdx: number;
    creditIdx: number;
    at: (row: string[], i: number) => string;
    invert: boolean;
  },
): number | null {
  const { amountIdx, debitIdx, creditIdx, at, invert } = opts;

  // Separate debit/credit columns: exactly one is normally filled per row.
  if (debitIdx >= 0 || creditIdx >= 0) {
    const debit = debitIdx >= 0 ? parseAmount(at(row, debitIdx)) : null;
    const credit = creditIdx >= 0 ? parseAmount(at(row, creditIdx)) : null;
    if (debit != null && debit !== 0) return -Math.abs(debit);
    if (credit != null && credit !== 0) return Math.abs(credit);
    if (debit === 0 || credit === 0) return 0;
    return null;
  }

  if (amountIdx < 0) return null;
  const value = parseAmount(at(row, amountIdx));
  if (value == null) return null;
  return invert ? -value : value;
}

/** When no description column was mapped, stitch the leftover text columns. */
function buildFallbackDescription(row: string[], headers: string[], skip: number[]): string {
  const skipSet = new Set(skip.filter((i) => i >= 0));
  const parts: string[] = [];
  for (let i = 0; i < row.length; i++) {
    if (skipSet.has(i)) continue;
    const value = (row[i] ?? '').trim();
    if (value === '' || parseAmount(value) !== null || parseDate(value)) continue;
    parts.push(value);
  }
  return parts.join(' ').trim() || (headers.length > 0 ? '' : '');
}
