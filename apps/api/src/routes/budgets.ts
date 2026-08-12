import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  addMonths,
  periodBounds,
  recentPeriods,
  upsertBudgetSchema,
  type PeriodKey,
} from '@household/shared';
import { prisma } from '../prisma.js';
import { badRequest } from '../lib/errors.js';
import {
  computeBudgetStatus,
  computeRolloverOut,
  suggestBudget,
  type BudgetLineInput,
} from '../services/budget.js';
import { loadCategoryMap } from '../services/ledger.js';

const householdParams = z.object({ householdId: z.string() });
const periodQuery = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
});

const budgetRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/:householdId/budget', async (request) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId);

    const { period = currentPeriod() } = periodQuery.parse(request.query ?? {});
    return buildStatus(householdId, period);
  });

  fastify.put('/:householdId/budget', async (request) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');
    const body = upsertBudgetSchema.parse(request.body);

    const categoryMap = await loadCategoryMap(householdId);
    for (const line of body.lines) {
      if (!categoryMap.has(line.categorySlug)) {
        throw badRequest(`Unknown category "${line.categorySlug}"`);
      }
    }

    await prisma.$transaction(async (tx) => {
      const budget = await tx.budget.upsert({
        where: { householdId_period: { householdId, period: body.period } },
        create: {
          householdId,
          period: body.period,
          expectedIncome: body.expectedIncome ?? null,
        },
        update: { expectedIncome: body.expectedIncome ?? null },
        select: { id: true },
      });

      // Replace the whole line set — the client always sends the full budget,
      // so a removed line must actually disappear.
      await tx.budgetLine.deleteMany({ where: { budgetId: budget.id } });
      if (body.lines.length > 0) {
        await tx.budgetLine.createMany({
          data: body.lines.map((line) => ({
            budgetId: budget.id,
            categoryId: categoryMap.get(line.categorySlug)!,
            limit: line.limit,
            rollover: line.rollover,
          })),
        });
      }
    });

    return buildStatus(householdId, body.period);
  });

  /**
   * Proposes limits from the last six months of spending. The starting point
   * offered when a household has no budget yet.
   */
  fastify.get('/:householdId/budget/suggestion', async (request) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId);
    const { period = currentPeriod() } = periodQuery.parse(request.query ?? {});

    const periods = recentPeriods(addMonths(period, -1), 6);
    const grouped = await prisma.transaction.groupBy({
      by: ['categoryId', 'period'],
      where: { householdId, period: { in: periods } },
      _sum: { amount: true },
    });

    const categories = await prisma.category.findMany({
      where: { householdId },
      select: { id: true, slug: true, isFixed: true, kind: true },
    });
    const slugById = new Map(categories.map((c) => [c.id, c]));

    const historyByCategory = new Map<string, number[]>();
    for (const row of grouped) {
      if (!row.categoryId) continue;
      const category = slugById.get(row.categoryId);
      if (!category || category.kind !== 'expense') continue;

      const list = historyByCategory.get(category.slug) ?? [];
      list.push(row._sum.amount ?? 0);
      historyByCategory.set(category.slug, list);
    }

    const suggestions = suggestBudget({
      historyByCategory,
      fixedCategories: new Set(categories.filter((c) => c.isFixed).map((c) => c.slug)),
    });

    return {
      period,
      lines: [...suggestions].map(([categorySlug, limit]) => ({
        categorySlug,
        limit,
        rollover: false,
      })),
      basedOnPeriods: periods,
    };
  });

  async function buildStatus(householdId: string, period: PeriodKey) {
    const household = await prisma.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { baseCurrency: true },
    });

    const [budget, categories] = await Promise.all([
      prisma.budget.findUnique({
        where: { householdId_period: { householdId, period } },
        include: { lines: { include: { category: true } } },
      }),
      prisma.category.findMany({ where: { householdId } }),
    ]);

    const netByCategory = await netTotalsFor(householdId, period);

    const lines: BudgetLineInput[] = (budget?.lines ?? []).map((line) => ({
      categorySlug: line.category.slug,
      categoryName: line.category.name,
      groupSlug: line.category.groupSlug,
      color: line.category.color,
      limit: line.limit,
      rollover: line.rollover,
    }));

    const budgetedSlugs = new Set(lines.map((l) => l.categorySlug));
    const expenseSlugs = new Set(categories.filter((c) => c.kind === 'expense').map((c) => c.slug));

    let unbudgetedSpend = 0;
    for (const [slug, net] of netByCategory) {
      if (budgetedSlugs.has(slug) || !expenseSlugs.has(slug)) continue;
      if (net < 0) unbudgetedSpend += -net;
    }

    const incomeSlugs = new Set(categories.filter((c) => c.kind === 'income').map((c) => c.slug));
    let actualIncome = 0;
    for (const [slug, net] of netByCategory) {
      if (incomeSlugs.has(slug) && net > 0) actualIncome += net;
    }

    const rolloverIn = await computeRolloverIn(householdId, period, lines);

    return computeBudgetStatus({
      period,
      currency: household.baseCurrency as 'SEK',
      lines,
      netByCategory,
      rolloverIn,
      expectedIncome: budget?.expectedIncome ?? null,
      actualIncome,
      unbudgetedSpend,
    });
  }

  /**
   * Rollover is only carried from the immediately preceding period. Chaining
   * further back would need every intervening month recomputed on each
   * request, and a household that has not looked at its budget for six months
   * does not want six months of accumulated envelope credit.
   */
  async function computeRolloverIn(
    householdId: string,
    period: PeriodKey,
    lines: readonly BudgetLineInput[],
  ): Promise<Map<string, number>> {
    const rolloverLines = lines.filter((l) => l.rollover);
    if (rolloverLines.length === 0) return new Map();

    const previous = addMonths(period, -1);
    const previousBudget = await prisma.budget.findUnique({
      where: { householdId_period: { householdId, period: previous } },
      include: { lines: { include: { category: true } } },
    });
    if (!previousBudget) return new Map();

    const previousNet = await netTotalsFor(householdId, previous);
    const previousStatus = computeBudgetStatus({
      period: previous,
      currency: 'SEK',
      lines: previousBudget.lines.map((line) => ({
        categorySlug: line.category.slug,
        categoryName: line.category.name,
        groupSlug: line.category.groupSlug,
        color: line.category.color,
        limit: line.limit,
        rollover: line.rollover,
      })),
      netByCategory: previousNet,
      actualIncome: 0,
      unbudgetedSpend: 0,
    });

    const carried = computeRolloverOut(previousStatus);
    const allowed = new Set(rolloverLines.map((l) => l.categorySlug));
    return new Map([...carried].filter(([slug]) => allowed.has(slug)));
  }
};

/** Net signed total per category slug for one period. */
async function netTotalsFor(householdId: string, period: PeriodKey): Promise<Map<string, number>> {
  const { start, end } = periodBounds(period);

  const grouped = await prisma.transaction.groupBy({
    by: ['categoryId'],
    where: { householdId, date: { gte: start, lte: end } },
    _sum: { amount: true },
  });

  const categories = await prisma.category.findMany({
    where: { householdId },
    select: { id: true, slug: true },
  });
  const slugById = new Map(categories.map((c) => [c.id, c.slug]));

  const totals = new Map<string, number>();
  for (const row of grouped) {
    const slug = row.categoryId ? slugById.get(row.categoryId) : 'uncategorised';
    if (!slug) continue;
    totals.set(slug, (totals.get(slug) ?? 0) + (row._sum.amount ?? 0));
  }
  return totals;
}

function currentPeriod(): PeriodKey {
  return new Date().toISOString().slice(0, 7);
}

export { netTotalsFor };
export default budgetRoutes;
