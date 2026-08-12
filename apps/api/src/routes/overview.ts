import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { addMonths, periodBounds, recentPeriods, type PeriodKey } from '@household/shared';
import { prisma } from '../prisma.js';
import { computeOverview, type LedgerEntry } from '../services/overview.js';
import { findConnectionsNeedingAttention } from '../services/sync.js';

const householdParams = z.object({ householdId: z.string() });
const overviewQuery = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  trendMonths: z.coerce.number().int().min(2).max(24).optional(),
});

const overviewRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/:householdId/overview', async (request) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId);

    const { period = currentPeriod(), trendMonths = 6 } = overviewQuery.parse(request.query ?? {});
    const previous = addMonths(period, -1);
    const trendPeriods = recentPeriods(period, trendMonths);

    const household = await prisma.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { baseCurrency: true },
    });

    // One query covers the current period, the comparison period and the whole
    // trend window, then the rows are bucketed in memory. Cheaper than a query
    // per month, and the window is bounded at 24.
    const [entries, accounts, goals, staleConnections, uncategorised] = await Promise.all([
      loadEntries(householdId, trendPeriods.concat(previous)),
      prisma.account.findMany({
        where: { householdId, archivedAt: null },
        select: { id: true, balance: true, includeInNetWorth: true, connectionId: true },
      }),
      prisma.goalContribution.aggregate({
        where: { goal: { householdId }, date: { gte: periodBounds(period).start, lte: periodBounds(period).end } },
        _sum: { amount: true },
      }),
      findConnectionsNeedingAttention(householdId),
      prisma.transaction.count({
        where: { householdId, category: { slug: 'uncategorised' } },
      }),
    ]);

    const byPeriod = new Map<PeriodKey, LedgerEntry[]>();
    for (const entry of entries) {
      const list = byPeriod.get(entry.period);
      if (list) list.push({ categorySlug: entry.categorySlug, amount: entry.amount });
      else byPeriod.set(entry.period, [{ categorySlug: entry.categorySlug, amount: entry.amount }]);
    }

    const netWorth = accounts
      .filter((a) => a.includeInNetWorth)
      .reduce((sum, a) => sum + a.balance, 0);

    const staleAccountIds = accounts
      .filter((a) => a.connectionId && staleConnections.includes(a.connectionId))
      .map((a) => a.id);

    const trendEntries = new Map<PeriodKey, LedgerEntry[]>();
    for (const p of trendPeriods) trendEntries.set(p, byPeriod.get(p) ?? []);

    return computeOverview({
      period,
      currency: household.baseCurrency as 'SEK',
      entries: byPeriod.get(period) ?? [],
      previousEntries: byPeriod.get(previous) ?? [],
      trendEntries,
      netWorth,
      savedToGoals: goals._sum.amount ?? 0,
      uncategorisedCount: uncategorised,
      staleAccountIds,
    });
  });

  /** Spend broken down by category for an arbitrary date range. */
  fastify.get('/:householdId/insights/categories', async (request) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId);

    const { from, to } = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(request.query ?? {});

    const grouped = await prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { householdId, date: { gte: from, lte: to } },
      _sum: { amount: true },
      _count: true,
    });

    const categories = await prisma.category.findMany({
      where: { householdId },
      select: { id: true, slug: true, name: true, groupSlug: true, groupName: true, color: true, kind: true },
    });
    const byId = new Map(categories.map((c) => [c.id, c]));

    const slices = grouped
      .map((row) => {
        const category = row.categoryId ? byId.get(row.categoryId) : undefined;
        if (!category || category.kind !== 'expense') return null;
        const net = row._sum.amount ?? 0;
        if (net >= 0) return null;
        return {
          categorySlug: category.slug,
          categoryName: category.name,
          groupSlug: category.groupSlug,
          groupName: category.groupName,
          color: category.color,
          amount: -net,
          transactionCount: row._count,
          changeVsPrevious: null,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s != null)
      .sort((a, b) => b.amount - a.amount);

    return {
      from,
      to,
      total: slices.reduce((sum, s) => sum + s.amount, 0),
      categories: slices,
    };
  });

  /**
   * Recurring charges — subscriptions and direct debits. Finding the
   * forgotten 139 kr/month is one of the highest-value things the app can do.
   */
  fastify.get('/:householdId/insights/recurring', async (request) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId);

    const since = addMonths(currentPeriod(), -6);
    const rows = await prisma.transaction.findMany({
      where: { householdId, period: { gte: since }, amount: { lt: 0 } },
      select: { merchant: true, description: true, amount: true, period: true, date: true },
    });

    const groups = new Map<string, { amounts: number[]; periods: Set<string>; lastDate: string; label: string }>();
    for (const row of rows) {
      const key = (row.merchant ?? row.description).toLowerCase().trim();
      if (!key) continue;
      const existing = groups.get(key);
      if (existing) {
        existing.amounts.push(row.amount);
        existing.periods.add(row.period);
        if (row.date > existing.lastDate) existing.lastDate = row.date;
      } else {
        groups.set(key, {
          amounts: [row.amount],
          periods: new Set([row.period]),
          lastDate: row.date,
          label: row.merchant ?? row.description,
        });
      }
    }

    // A charge appearing in at least three distinct months, at a consistent
    // amount, is a subscription rather than a coincidence.
    const recurring = [...groups.values()]
      .filter((g) => g.periods.size >= 3 && isConsistent(g.amounts))
      .map((g) => ({
        label: g.label,
        monthlyAmount: Math.round(g.amounts.reduce((a, b) => a + b, 0) / g.periods.size),
        occurrences: g.amounts.length,
        monthsSeen: g.periods.size,
        lastCharged: g.lastDate,
      }))
      .sort((a, b) => a.monthlyAmount - b.monthlyAmount);

    return {
      recurring,
      totalMonthly: recurring.reduce((sum, r) => sum + r.monthlyAmount, 0),
    };
  });
};

/** Amounts within 10% of the mean count as the same recurring charge. */
function isConsistent(amounts: readonly number[]): boolean {
  if (amounts.length < 2) return false;
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  if (mean === 0) return false;
  return amounts.every((a) => Math.abs((a - mean) / mean) < 0.1);
}

async function loadEntries(
  householdId: string,
  periods: readonly PeriodKey[],
): Promise<{ period: string; categorySlug: string; amount: number }[]> {
  const unique = [...new Set(periods)];

  const grouped = await prisma.transaction.groupBy({
    by: ['period', 'categoryId'],
    where: { householdId, period: { in: unique } },
    _sum: { amount: true },
  });

  const categories = await prisma.category.findMany({
    where: { householdId },
    select: { id: true, slug: true },
  });
  const slugById = new Map(categories.map((c) => [c.id, c.slug]));

  return grouped.map((row) => ({
    period: row.period,
    categorySlug: (row.categoryId ? slugById.get(row.categoryId) : null) ?? 'uncategorised',
    amount: row._sum.amount ?? 0,
  }));
}

function currentPeriod(): PeriodKey {
  return new Date().toISOString().slice(0, 7);
}

export default overviewRoutes;
