import type { DateKey } from '@household/shared';

/**
 * Internal-transfer detection.
 *
 * Moving 5 000 kr from the current account to the savings account produces two
 * transactions. Counted naively that is 5 000 kr of "spending" and 5 000 kr of
 * "income", and every total in the app is wrong. Pairing the two legs and
 * marking them as transfers is what keeps "where did our cash go" honest.
 *
 * The same logic catches credit-card settlement: the payment leaving the
 * current account pairs with the credit arriving on the card.
 */

export interface PairableTransaction {
  id: string;
  accountId: string;
  date: DateKey;
  amount: number;
  description: string;
}

export interface TransferPair {
  outgoingId: string;
  incomingId: string;
  amount: number;
  /** Days between the two legs. Banks rarely book both the same day. */
  lagDays: number;
  confidence: number;
}

export interface DetectOptions {
  /** How many days apart the legs may be booked. */
  maxLagDays?: number;
  /** Ignore movements below this, to avoid pairing coincidental small sums. */
  minAmount?: number;
}

export function detectTransfers(
  transactions: readonly PairableTransaction[],
  options: DetectOptions = {},
): TransferPair[] {
  const maxLagDays = options.maxLagDays ?? 4;
  const minAmount = options.minAmount ?? 5000; // 50 kr

  const outgoing = transactions
    .filter((t) => t.amount <= -minAmount)
    .sort((a, b) => a.date.localeCompare(b.date));
  const incoming = transactions.filter((t) => t.amount >= minAmount);

  // Index candidates by magnitude — the two legs of a transfer are equal and
  // opposite, so this reduces the search to a handful per outgoing row.
  const byMagnitude = new Map<number, PairableTransaction[]>();
  for (const t of incoming) {
    const key = Math.abs(t.amount);
    const bucket = byMagnitude.get(key);
    if (bucket) bucket.push(t);
    else byMagnitude.set(key, [t]);
  }

  const pairs: TransferPair[] = [];
  const claimed = new Set<string>();

  for (const out of outgoing) {
    const candidates = byMagnitude.get(Math.abs(out.amount));
    if (!candidates) continue;

    let best: { tx: PairableTransaction; lag: number; confidence: number } | null = null;

    for (const candidate of candidates) {
      if (claimed.has(candidate.id)) continue;
      // A transfer moves money between two different accounts.
      if (candidate.accountId === out.accountId) continue;

      const lag = dayDifference(out.date, candidate.date);
      // The incoming leg cannot be booked meaningfully before the outgoing one.
      if (lag < -1 || lag > maxLagDays) continue;

      const confidence = scorePair(out, candidate, Math.abs(lag));
      if (!best || confidence > best.confidence) {
        best = { tx: candidate, lag: Math.abs(lag), confidence };
      }
    }

    if (best && best.confidence >= 0.5) {
      claimed.add(best.tx.id);
      pairs.push({
        outgoingId: out.id,
        incomingId: best.tx.id,
        amount: Math.abs(out.amount),
        lagDays: best.lag,
        confidence: best.confidence,
      });
    }
  }

  return pairs;
}

/**
 * Equal-and-opposite on the same day between two of your own accounts is
 * almost certainly a transfer. Confidence decays with the booking lag, and
 * rises when the text says so.
 */
function scorePair(out: PairableTransaction, incoming: PairableTransaction, lag: number): number {
  let score = 0.6;
  score -= lag * 0.1;

  const text = `${out.description} ${incoming.description}`.toLowerCase();
  if (/(överföring|overforing|transfer|egen insättning|internöverföring|mellan konton)/.test(text)) {
    score += 0.3;
  }
  if (/(sparkonto|savings|buffert|kortbetalning|kreditkort|faktura)/.test(text)) {
    score += 0.1;
  }
  // A round amount is weak evidence — people transfer 5 000, not 4 973.
  if (Math.abs(out.amount) % 100000 === 0) score += 0.05;

  return Math.max(0, Math.min(score, 1));
}

function dayDifference(from: DateKey, to: DateKey): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86_400_000);
}
