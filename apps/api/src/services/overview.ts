import type { CategorySpendSlice, Currency, OverviewDTO, PeriodKey } from '@household/shared';
import { CATEGORY_GROUPS, findCategory, periodProgress, daysInPeriod } from '@household/shared';

/**
 * The overview screen's numbers.
 *
 * The point of the app is answering "where did our cash go", so the rules
 * about what counts are the important part here:
 *
 * - Only categories of kind `expense` count as spend. Transfers between own
 *   accounts and money moved into savings are excluded — that cash has not
 *   left the household.
 * - Income counts only categories of kind `income`, so a transfer landing in
 *   the current account never masquerades as a payday.
 * - Refunds net off the category they came from rather than adding to income.
 */

export interface LedgerEntry {
  categorySlug: string;
  amount: number; // signed minor units
}

export interface ComputeOverviewInput {
  period: PeriodKey;
  currency: Currency;
  entries: readonly LedgerEntry[];
  /** Same shape, for the preceding period — drives the change indicators. */
  previousEntries?: readonly LedgerEntry[];
  /** Signed totals per period for the trend strip, oldest first. */
  trendEntries?: ReadonlyMap<PeriodKey, readonly LedgerEntry[]>;
  netWorth: number;
  savedToGoals: number;
  uncategorisedCount: number;
  staleAccountIds: readonly string[];
  now?: Date;
}

export function computeOverview(input: ComputeOverviewInput): OverviewDTO {
  const now = input.now ?? new Date();
  const totals = summarise(input.entries);
  const previousTotals = input.previousEntries ? summarise(input.previousEntries) : null;

  const byCategory = buildSlices(totals.spendByCategory, previousTotals?.spendByCategory ?? null);
  const byGroup = aggregateByGroup(byCategory);

  const progress = periodProgress(input.period, now);
  const days = daysInPeriod(input.period);
  const elapsedDays = Math.max(progress * days, 1);
  const dailyBurnRate = Math.round(totals.spend / elapsedDays);

  const trend: { period: PeriodKey; income: number; spend: number }[] = [];
  if (input.trendEntries) {
    for (const [period, entries] of input.trendEntries) {
      const t = summarise(entries);
      trend.push({ period, income: t.income, spend: t.spend });
    }
    trend.sort((a, b) => a.period.localeCompare(b.period));
  }

  return {
    period: input.period,
    currency: input.currency,
    income: totals.income,
    spend: totals.spend,
    net: totals.income - totals.spend,
    savedToGoals: input.savedToGoals,
    netWorth: input.netWorth,
    dailyBurnRate,
    projectedSpend: Math.round(dailyBurnRate * days),
    byGroup,
    topCategories: byCategory.slice(0, 8),
    trend,
    uncategorisedCount: input.uncategorisedCount,
    staleAccountIds: [...input.staleAccountIds],
  };
}

interface Totals {
  income: number;
  spend: number;
  spendByCategory: Map<string, { amount: number; count: number }>;
}

/**
 * Nets each category first, then classifies. Netting before flooring is what
 * makes a refund reduce the category rather than register as income.
 */
export function summarise(entries: readonly LedgerEntry[]): Totals {
  const netByCategory = new Map<string, { net: number; count: number }>();

  for (const entry of entries) {
    const current = netByCategory.get(entry.categorySlug) ?? { net: 0, count: 0 };
    current.net += entry.amount;
    current.count += 1;
    netByCategory.set(entry.categorySlug, current);
  }

  let income = 0;
  let spend = 0;
  const spendByCategory = new Map<string, { amount: number; count: number }>();

  for (const [slug, { net, count }] of netByCategory) {
    const kind = findCategory(slug)?.kind ?? 'expense';

    if (kind === 'transfer') continue; // never spending, never income

    if (kind === 'income') {
      if (net > 0) income += net;
      continue;
    }

    // Expense category. Negative net = money spent.
    if (net < 0) {
      const amount = -net;
      spend += amount;
      spendByCategory.set(slug, { amount, count });
    }
  }

  return { income, spend, spendByCategory };
}

function buildSlices(
  current: ReadonlyMap<string, { amount: number; count: number }>,
  previous: ReadonlyMap<string, { amount: number; count: number }> | null,
): CategorySpendSlice[] {
  const slices: CategorySpendSlice[] = [];

  for (const [slug, { amount, count }] of current) {
    const meta = findCategory(slug);
    const previousAmount = previous?.get(slug)?.amount ?? null;

    slices.push({
      categorySlug: slug,
      categoryName: meta?.name ?? slug,
      groupSlug: meta?.groupSlug ?? 'other',
      groupName: meta?.groupName ?? 'Other',
      color: meta?.color ?? '#CED4DA',
      amount,
      transactionCount: count,
      changeVsPrevious:
        previousAmount != null && previousAmount > 0
          ? (amount - previousAmount) / previousAmount
          : null,
    });
  }

  return slices.sort((a, b) => b.amount - a.amount);
}

function aggregateByGroup(slices: readonly CategorySpendSlice[]): CategorySpendSlice[] {
  const groups = new Map<string, CategorySpendSlice>();

  for (const slice of slices) {
    const existing = groups.get(slice.groupSlug);
    if (existing) {
      existing.amount += slice.amount;
      existing.transactionCount += slice.transactionCount;
      continue;
    }

    const groupDef = CATEGORY_GROUPS.find((g) => g.slug === slice.groupSlug);
    groups.set(slice.groupSlug, {
      categorySlug: slice.groupSlug,
      categoryName: groupDef?.name ?? slice.groupName,
      groupSlug: slice.groupSlug,
      groupName: groupDef?.name ?? slice.groupName,
      color: groupDef?.color ?? slice.color,
      amount: slice.amount,
      transactionCount: slice.transactionCount,
      changeVsPrevious: null,
    });
  }

  return [...groups.values()].sort((a, b) => b.amount - a.amount);
}
