import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';
import { detectFormat, foldHeader, inferMapping } from '../services/import/formats.js';
import { applyMapping, decodeBuffer, detectDelimiter, readCsv } from '../services/import/parse.js';

/**
 * Fixtures approximate the real exports from each bank: semicolon delimiters,
 * comma decimals, space-grouped thousands, Swedish headers.
 */

const HANDELSBANKEN = `Reskontradatum;Transaktionsdatum;Text;Belopp;Saldo
2024-05-17;2024-05-17;ICA KVANTUM VASASTAN;-459,00;12 340,50
2024-05-16;2024-05-16;LÖN ACME AB;34 500,00;12 799,50
2024-05-15;2024-05-15;SPOTIFY AB;-139,00;-21 700,50`;

const LANSFORSAKRINGAR = `Bokföringsdag;Text;Belopp;Saldo
2024-05-17;KORT 1234 COOP KONSUM;-289,50;8 210,25
2024-05-16;HYRA BRF SOLGÅRDEN;-12 500,00;8 499,75`;

const SWEDBANK = `Radnummer,Clearingnummer,Kontonummer,Produkt,Valuta,Bokföringsdag,Transaktionsdag,Valutadag,Referens,Beskrivning,Belopp,Bokfört saldo
1,8327-9,123 456 789-0,Privatkonto,SEK,2024-05-17,2024-05-17,2024-05-17,ICA,ICA KVANTUM,-459.00,12340.50
2,8327-9,123 456 789-0,Privatkonto,SEK,2024-05-16,2024-05-16,2024-05-16,LON,LÖN ACME AB,34500.00,12799.50`;

const AMEX = `Datum,Beskrivning,Belopp
2024-05-17,ELGIGANTEN 254,1299.00
2024-05-16,SAS SCANDINAVIAN,4520.00`;

const WITH_PREAMBLE = `Kontoutdrag Privatkonto
Kontonummer: 1234-5 678 901

Datum;Text;Belopp;Saldo
2024-05-17;ICA KVANTUM;-459,00;12 340,50`;

const DEBIT_CREDIT = `Datum;Text;Uttag;Insättning;Saldo
2024-05-17;ICA KVANTUM;459,00;;12 340,50
2024-05-16;LÖN ACME AB;;34 500,00;12 799,50`;

describe('foldHeader', () => {
  it('folds Swedish characters to ASCII', () => {
    expect(foldHeader('Bokföringsdatum')).toBe('bokforingsdatum');
    expect(foldHeader('Insättning')).toBe('insattning');
  });

  it('strips a byte-order mark', () => {
    expect(foldHeader('﻿Datum')).toBe('datum');
  });
});

describe('detectDelimiter', () => {
  it('picks semicolon for Swedish exports', () => {
    expect(detectDelimiter(HANDELSBANKEN)).toBe(';');
  });

  it('picks comma for comma-separated files', () => {
    expect(detectDelimiter(AMEX)).toBe(',');
  });

  it('is not fooled by a preamble line without delimiters', () => {
    expect(detectDelimiter(WITH_PREAMBLE)).toBe(';');
  });
});

describe('decodeBuffer', () => {
  it('reads UTF-8', () => {
    expect(decodeBuffer(Buffer.from('LÖN ACME', 'utf8'))).toBe('LÖN ACME');
  });

  it('strips a UTF-8 BOM', () => {
    expect(decodeBuffer(Buffer.from('﻿Datum', 'utf8'))).toBe('Datum');
  });

  it('falls back to windows-1252 for legacy exports', () => {
    // Handelsbanken still exports Latin-1 in places.
    const latin1 = iconv.encode('LÖN ACME AB', 'win1252');
    expect(decodeBuffer(latin1)).toBe('LÖN ACME AB');
  });
});

describe('format detection', () => {
  it('recognises Handelsbanken', () => {
    const file = readCsv(Buffer.from(HANDELSBANKEN, 'utf8'));
    const detection = detectFormat(file.headers, file.rows);
    expect(detection.method).toBe('signature');
    expect(detection.format?.id).toBe('handelsbanken');
    expect(detection.mapping.date).toBe('Reskontradatum');
    expect(detection.mapping.amount).toBe('Belopp');
  });

  it('recognises Länsförsäkringar', () => {
    const file = readCsv(Buffer.from(LANSFORSAKRINGAR, 'utf8'));
    const detection = detectFormat(file.headers, file.rows);
    expect(detection.format?.id).toBe('lansforsakringar');
    expect(detection.mapping.description).toBe('Text');
  });

  it('recognises Swedbank and ignores its many extra columns', () => {
    const file = readCsv(Buffer.from(SWEDBANK, 'utf8'));
    const detection = detectFormat(file.headers, file.rows);
    expect(detection.format?.id).toBe('swedbank');
    expect(detection.mapping.date).toBe('Bokföringsdag');
    expect(detection.mapping.balance).toBe('Bokfört saldo');
  });

  it('recognises Amex and flags the sign inversion', () => {
    const file = readCsv(Buffer.from(AMEX, 'utf8'));
    const detection = detectFormat(file.headers, file.rows);
    expect(detection.format?.id).toBe('amex-se');
    expect(detection.mapping.invertAmount).toBe(true);
  });

  it('infers a mapping for an unknown layout', () => {
    const unknown = `When;What;How much;Running total
2024-05-17;ICA KVANTUM;-459,00;12 340,50
2024-05-16;LÖN ACME AB;34 500,00;12 799,50
2024-05-15;SPOTIFY;-139,00;12 799,50`;
    const file = readCsv(Buffer.from(unknown, 'utf8'));
    const detection = detectFormat(file.headers, file.rows);
    expect(detection.method).toBe('inferred');
    expect(detection.mapping.date).toBe('When');
    expect(detection.mapping.description).toBe('What');
    expect(detection.mapping.amount).toBe('How much');
  });

  it('does not mistake the balance column for the amount', () => {
    const file = readCsv(Buffer.from(LANSFORSAKRINGAR, 'utf8'));
    const inferred = inferMapping(file.headers, file.rows);
    expect(inferred.balance).toBe('Saldo');
    expect(inferred.amount).toBe('Belopp');
  });
});

describe('reading rows', () => {
  it('skips a preamble and finds the real header', () => {
    const file = readCsv(Buffer.from(WITH_PREAMBLE, 'utf8'));
    expect(file.headers).toEqual(['Datum', 'Text', 'Belopp', 'Saldo']);
    expect(file.rows).toHaveLength(1);
  });

  it('rejects an empty file with a clear message', () => {
    expect(() => readCsv(Buffer.from('', 'utf8'))).toThrow(/empty/i);
  });
});

describe('applyMapping', () => {
  it('parses Handelsbanken rows into signed minor units', () => {
    const file = readCsv(Buffer.from(HANDELSBANKEN, 'utf8'));
    const { mapping } = detectFormat(file.headers, file.rows);
    const rows = applyMapping(file, mapping);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      date: '2024-05-17',
      amount: -45900,
      description: 'ICA KVANTUM VASASTAN',
      balanceAfter: 1234050,
    });
    expect(rows[1]!.amount).toBe(3450000);
    expect(rows.every((r) => r.error === undefined)).toBe(true);
  });

  it('inverts Amex charges so a purchase is negative', () => {
    const file = readCsv(Buffer.from(AMEX, 'utf8'));
    const { mapping } = detectFormat(file.headers, file.rows);
    const rows = applyMapping(file, mapping);

    expect(rows[0]!.amount).toBe(-129900);
    expect(rows[1]!.amount).toBe(-452000);
  });

  it('merges separate debit and credit columns', () => {
    const file = readCsv(Buffer.from(DEBIT_CREDIT, 'utf8'));
    const { mapping } = detectFormat(file.headers, file.rows);
    const rows = applyMapping(file, mapping);

    expect(rows[0]!.amount).toBe(-45900);
    expect(rows[1]!.amount).toBe(3450000);
  });

  it('reports unparseable rows instead of dropping them', () => {
    const broken = `Datum;Text;Belopp;Saldo
2024-05-17;ICA KVANTUM;-459,00;12 340,50
inte-ett-datum;TRASIG RAD;-100,00;0,00`;
    const file = readCsv(Buffer.from(broken, 'utf8'));
    const { mapping } = detectFormat(file.headers, file.rows);
    const rows = applyMapping(file, mapping);

    expect(rows).toHaveLength(2);
    expect(rows[0]!.error).toBeUndefined();
    expect(rows[1]!.error).toMatch(/date/i);
  });

  it('handles a quoted description containing the delimiter', () => {
    const quoted = `Datum;Text;Belopp;Saldo
2024-05-17;"BUTIK; MED SEMIKOLON";-459,00;12 340,50`;
    const file = readCsv(Buffer.from(quoted, 'utf8'));
    const { mapping } = detectFormat(file.headers, file.rows);
    const rows = applyMapping(file, mapping);

    expect(rows[0]!.description).toBe('BUTIK; MED SEMIKOLON');
    expect(rows[0]!.amount).toBe(-45900);
  });
});
