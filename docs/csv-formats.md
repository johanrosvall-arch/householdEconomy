# Importing statement files

Uploading a CSV or Excel export works for every account, including the ones
PSD2 aggregators do not reach (Amex, Klarna, store cards). The importer is
built to handle real bank exports rather than idealised CSV.

## The three-step flow

Nothing touches the ledger until the user confirms. A bad column mapping that
writes straight to the database gives you a month of amounts with the wrong
sign, and no obvious way back.

1. `POST /households/:id/imports` — upload. Parses, detects the format, stages
   the rows, returns a preview with a sample and a duplicate count.
2. `POST /households/:id/imports/:batchId/preview` — optional. Re-previews with
   a corrected column mapping.
3. `POST /households/:id/imports/:batchId/commit` — writes to the ledger.

Staged uploads expire after 24 hours. A committed import can be undone with
`DELETE`, which removes exactly the transactions it created.

## What the parser handles

These are the things that actually break naive CSV imports of Swedish bank data:

**Encoding.** Handelsbanken still emits ISO-8859-1 in places. The decoder
honours a BOM, tries UTF-8, and falls back to windows-1252 when it sees
replacement characters. UTF-16 with a BOM works too.

**Delimiters.** `;` is the Swedish default, because `,` is the decimal
separator. The detector counts candidates across the first 20 non-empty lines
and scores by *consistency*, not raw frequency — so a preamble line with no
delimiters does not skew the result.

**Preamble rows.** Exports often start with account metadata and a blank line
before the real header. `findHeaderRow` looks for the first row with several
non-empty cells and recognisable column words, and falls back to "a row of
non-data followed by a row of data".

**Amount formats.** `1 234,56`, `1.234,56`, `1,234.56`, `-1234.56`,
`1 234,56 kr`, `(1 234,56)` for negatives, `−1 234,56` with a Unicode minus,
and non-breaking / narrow-no-break spaces as thousands separators (Excel loves
these). Conversion to minor units shifts the decimal point textually rather
than multiplying, because `Math.round(1.005 * 100)` is 100, not 101.

One deliberate ambiguity call: a trailing group of exactly three digits with no
other separator (`1,234`) is read as **thousands**, not decimals — Swedish
exports write thousands far more often than three-decimal amounts. A leading
zero overrides this, so `0,005` is still five öre.

**Date formats.** `2024-05-17`, `2024/05/17`, `20240517`, `17/05/2024`,
`17.05.2024`, `17 maj 2024`. Impossible dates like `2024-02-31` are rejected
rather than silently rolled over into March.

**Separate debit/credit columns.** Some exports use `Uttag` / `Insättning`
instead of one signed `Belopp`. Merged into a single signed amount.

**Sign conventions.** Card issuers list a purchase as a *positive* charge.
Amex and Klarna formats set `invertAmount`, normalising everything to
negative-is-money-out.

## Recognised formats

Detected by fingerprinting the header row (ASCII-folded, so a file mangled from
Latin-1 still matches):

| Bank | Key columns |
| --- | --- |
| Handelsbanken | `Reskontradatum`, `Transaktionsdatum`, `Text`, `Belopp` |
| Handelsbanken (alt) | `Bokföringsdatum`, `Transaktionsdatum`, `Text`, `Belopp` |
| Länsförsäkringar | `Bokföringsdag`, `Text`, `Belopp`, `Saldo` |
| Swedbank | `Bokföringsdag`, `Transaktionsdag`, `Beskrivning`, `Belopp` |
| SEB | `Bokföringsdatum`, `Valutadatum`, `Text`, `Belopp` |
| Nordea | `Bokföringsdag`, `Belopp`, `Rubrik` |
| ICA Banken | `Datum`, `Beskrivning`, `Belopp`, `Saldo` |
| American Express | `Datum`, `Beskrivning`, `Belopp` — sign inverted |
| Klarna | `Datum`, `Butik`, `Belopp` — sign inverted |
| Revolut | `Started Date`, `Description`, `Amount` |

## Unknown formats

Anything not in that table falls through to content-based inference, which is
what makes "upload any CSV" work. Each column is scored on how many of its
sample values parse as a date, an amount, or text; header keywords act as a
prior but content decides. The balance column is claimed by its header first,
so it does not get mistaken for the transaction amount — a mistake that would
otherwise produce a ledger of running totals.

The user always sees the inferred mapping in the preview and can correct it
before committing.

## Duplicates

Re-uploading an overlapping statement is the normal case, not the exception.
Every transaction gets a `dedupeHash` over `(date, amount, normalised
description, occurrence)`.

The occurrence counter matters: two identical coffees on the same day at the
same price are genuinely two transactions, and a hash without it would silently
drop the second one. When the source provides a stable transaction id, that is
used in preference — it is the stronger key.

The preview reports the duplicate count before the user commits, and the commit
skips them unless `includeDuplicates` is set.

## Adding a format

Add an entry to `BANK_FORMATS` in
`apps/api/src/services/import/formats.ts`. The `signature` lists ASCII-folded
headers that must all be present; the most specific matching signature wins.
Add a fixture to `apps/api/src/__tests__/import.test.ts` alongside it — the
existing ones show the shape.
