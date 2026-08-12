import type { BudgetLineStatus, BudgetStatusDTO, Currency, PeriodKey } from '@household/shared';
import { periodProgress } from '@household/shared';

/**
 * Budget maths.
 *
 * Two decisions worth stating, because they shape everything the budget screen
 * shows:
 *
 * - Spend is expressed positive. Transactions are stored negative-is-out, but
 *   "you spent 4 200 kr of 5 000 kr" is how a household thinks, so amounts are
 *   flipped once, here, and stay positive through the DTO and the UI.
 *
 * - A refund reduces spend rather than counting as income. Returning a jacket
 *   should give you your clothing budget back, not inflate your salary. So a
 *   category's spend is the *net* of its transactions, floored at zero.
 */

export interface BudgetLineInput {
  categorySlug: string;
  categoryName: string;
  groupSlug: string;
  color: string;
  /** Positive minor units. */
  limit: number;
  rollover: boolean;
}

export interface ComputeBudgetInput {
  period: PeriodKey;
  currency: Currency;
  lines: readonly BudgetLineInput[];
  /**
   * Net signed total per category slug, straight from the ledger
   * (negative = spent). Categories absent from the map had no activity.
   */
  netByCategory: ReadonlyMap<string, number>;
  /** Unspent remainder carried in from earlier periods, per category. */
  rolloverIn?: ReadonlyMap<string, number>;
  expectedIncome?: number | null;
  /** Positive minor units of income booked in the period. */
  actualIncome: number;
  /** Spend in categories that have no budget line, positive minor units. */
  unbudgetedSpend: number;
  now?: Date;
}

/**
 * How far ahead of the calendar spending may run before it is called off-pace.
 * Without a tolerance a single big shop on the 2nd flags every line red.
 */
const PACE_TOLERANCE = 0.1;

export function computeBudgetStatus(input: ComputeBudgetInput): BudgetStatusDTO {
  const now = input.now ?? new Date();
  const progress = periodProgress(input.period, now);
  const rolloverIn = input.rolloverIn ?? new Map<string, number>();

  const lines: BudgetLineStatus[] = input.lines.map((line) => {
    const spent = spendFor(input.netByCategory, line.categorySlug);
    const carried = rolloverIn.get(line.categorySlug) ?? 0;
    const available = line.limit + carried;
    const remaining = available - spent;
    const utilisation = available > 0 ? spent / available : spent > 0 ? 1 : 0;

    return {
      categorySlug: line.categorySlug,
      categoryName: line.categoryName,
      groupSlug: line.groupSlug,
      color: line.color,
      limit: line.limit,
      rollover: line.rollover,
      spent,
      rolloverIn: carried,
      remaining,
      utilisation,
      offPace: progress < 1 && utilisation > progress + PACE_TOLERANCE,
    };
  });

  const totalLimit = lines.reduce((sum, l) => sum + l.limit, 0);
  const totalSpent = lines.reduce((sum, l) => sum + l.spent, 0);
  const totalRolloverIn = lines.reduce((sum, l) => sum + l.rolloverIn, 0);

  return {
    period: input.period,
    currency: input.currency,
    totalLimit,
    totalSpent,
    totalRemaining: totalLimit + totalRolloverIn - totalSpent,
    expectedIncome: input.expectedIncome ?? null,
    actualIncome: input.actualIncome,
    periodProgress: progress,
    lines,
    unbudgetedSpend: input.unbudgetedSpend,
  };
}

/**
 * Net spend for a category as a positive number. A category whose refunds
 * exceed its purchases nets to zero rather than negative spend, which would
 * otherwise read as "you have more budget than you started with".
 */
export function spendFor(netByCategory: ReadonlyMap<string, number>, slug: string): number {
  const net = netByCategory.get(slug) ?? 0;
  return net < 0 ? -net : 0;
}

/**
 * Rollover carried into the next period, for lines that opt in.
 * Overspend carries too — as a negative — otherwise a household could
 * overspend every month and never feel it.
 */
export function computeRolloverOut(status: BudgetStatusDTO): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of status.lines) {
    if (line.remaining !== 0) out.set(line.categorySlug, line.remaining);
  }
  return out;
}

/**
 * Suggests budget limits from history — the starting point offered when a
 * household creates its first budget.
 *
 * Uses the median of recent months rather than the mean, so one holiday or one
 * boiler repair does not permanently inflate the suggestion. Fixed categories
 * (rent, insurance) take the most recent value instead, since they are known
 * amounts rather than a distribution.
 */
export function suggestBudget(input: {
  /** Per category: net signed totals for recent periods, oldest first. */
  historyByCategory: ReadonlyMap<string, readonly number[]>;
  fixedCategories: ReadonlySet<string>;
  /** Round suggestions up to this many minor units. 100_00 = nearest 100 kr. */
  roundTo?: number;
}): Map<string, number> {
  const roundTo = input.roundTo ?? 10000;
  const suggestions = new Map<string, number>();

  for (const [slug, history] of input.historyByCategory) {
    const spends = history.map((net) => (net < 0 ? -net : 0)).filter((v) => v > 0);
    if (spends.length === 0) continue;

    const value = input.fixedCategories.has(slug) ? spends[spends.length - 1]! : median(spends);
    const rounded = Math.ceil(value / roundTo) * roundTo;
    if (rounded > 0) suggestions.set(slug, rounded);
  }

  return suggestions;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
