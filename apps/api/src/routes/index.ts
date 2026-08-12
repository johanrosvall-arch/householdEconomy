import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { createRuleSchema } from '@household/shared';
import { badRequest, notFound } from '../lib/errors.js';
import { createHousehold } from '../services/household-setup.js';
import { reclassifyBatch, type RuleLike } from '../services/categorisation.js';
import authRoutes from './auth.js';
import accountRoutes from './accounts.js';
import transactionRoutes from './transactions.js';
import budgetRoutes from './budgets.js';
import goalRoutes from './goals.js';
import importRoutes from './imports.js';
import connectionRoutes from './connections.js';
import overviewRoutes from './overview.js';
import mockBankRoutes from './mock-bank.js';

const householdParams = z.object({ householdId: z.string() });
const ruleParams = householdParams.extend({ ruleId: z.string() });

const registerRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(authRoutes, { prefix: '/auth' });

  // Development-only stand-in for a bank's consent page. Never mounted when a
  // real aggregator is configured.
  if (fastify.config.BANK_PROVIDER === 'mock') {
    await fastify.register(mockBankRoutes, { prefix: '/mock-bank' });
  }

  await fastify.register(async (scope) => {
    scope.post('/', async (request, reply) => {
      const userId = await scope.requireAuth(request);
      const body = z
        .object({
          name: z.string().min(1).max(120),
          baseCurrency: z.string().length(3).default('SEK'),
        })
        .parse(request.body);

      const household = await createHousehold({ ...body, userId });
      reply.status(201);
      return { household };
    });

    scope.get('/:householdId/categories', async (request) => {
      const { householdId } = householdParams.parse(request.params);
      await scope.requireHousehold(request, householdId);

      const categories = await prisma.category.findMany({
        where: { householdId, archivedAt: null },
        orderBy: { sortOrder: 'asc' },
      });

      return { categories };
    });

    scope.get('/:householdId/rules', async (request) => {
      const { householdId } = householdParams.parse(request.params);
      await scope.requireHousehold(request, householdId);

      const rules = await prisma.categoryRule.findMany({
        where: { householdId },
        include: { category: { select: { slug: true, name: true } } },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      });

      return { rules };
    });

    scope.post('/:householdId/rules', async (request, reply) => {
      const { householdId } = householdParams.parse(request.params);
      await scope.requireHousehold(request, householdId, 'member');
      const body = createRuleSchema.parse(request.body);

      const category = await prisma.category.findUnique({
        where: { householdId_slug: { householdId, slug: body.categorySlug } },
        select: { id: true },
      });
      if (!category) throw badRequest(`Unknown category "${body.categorySlug}"`);

      const rule = await prisma.categoryRule.create({
        data: {
          householdId,
          categoryId: category.id,
          field: body.field,
          matchType: body.matchType,
          pattern: body.pattern,
          minAmount: body.minAmount ?? null,
          maxAmount: body.maxAmount ?? null,
          accountId: body.accountId ?? null,
          priority: body.priority,
        },
      });

      const applied = await applyRulesToLedger(householdId);
      reply.status(201);
      return { rule, transactionsUpdated: applied };
    });

    scope.delete('/:householdId/rules/:ruleId', async (request) => {
      const { householdId, ruleId } = ruleParams.parse(request.params);
      await scope.requireHousehold(request, householdId, 'member');

      const rule = await prisma.categoryRule.findFirst({
        where: { id: ruleId, householdId },
        select: { id: true },
      });
      if (!rule) throw notFound('Rule');

      await prisma.categoryRule.delete({ where: { id: ruleId } });
      return { deleted: true, transactionsUpdated: await applyRulesToLedger(householdId) };
    });

    /** Re-runs every rule over the ledger — offered after bulk rule edits. */
    scope.post('/:householdId/rules/apply', async (request) => {
      const { householdId } = householdParams.parse(request.params);
      await scope.requireHousehold(request, householdId, 'member');
      return { transactionsUpdated: await applyRulesToLedger(householdId) };
    });

    await scope.register(accountRoutes);
    await scope.register(transactionRoutes);
    await scope.register(budgetRoutes);
    await scope.register(goalRoutes);
    await scope.register(importRoutes);
    await scope.register(connectionRoutes);
    await scope.register(overviewRoutes);
  }, { prefix: '/households' });
};

/**
 * Re-classifies every unlocked transaction against the current rule set.
 *
 * Bounded to the last two years: older history is settled, and rescanning it
 * on every rule edit would make the request time grow without limit.
 */
async function applyRulesToLedger(householdId: string, monthsBack = 24): Promise<number> {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - monthsBack);
  const sinceKey = since.toISOString().slice(0, 10);

  const [ruleRows, transactions, categories] = await Promise.all([
    prisma.categoryRule.findMany({
      where: { householdId },
      include: { category: { select: { slug: true } } },
      orderBy: { priority: 'desc' },
    }),
    prisma.transaction.findMany({
      where: { householdId, categoryLocked: false, date: { gte: sinceKey } },
      select: {
        id: true,
        description: true,
        amount: true,
        accountId: true,
        merchant: true,
        counterparty: true,
        categoryLocked: true,
        category: { select: { slug: true } },
      },
    }),
    prisma.category.findMany({ where: { householdId }, select: { id: true, slug: true } }),
  ]);

  const rules: RuleLike[] = ruleRows.map((r) => ({
    id: r.id,
    field: r.field,
    matchType: r.matchType,
    pattern: r.pattern,
    categorySlug: r.category.slug,
    minAmount: r.minAmount,
    maxAmount: r.maxAmount,
    accountId: r.accountId,
    priority: r.priority,
  }));

  const categoryIdBySlug = new Map(categories.map((c) => [c.slug, c.id]));
  const updates = reclassifyBatch(transactions, rules);

  // Only write rows whose category actually changed — a no-op update on
  // thousands of transactions is pure write amplification.
  const currentSlug = new Map(transactions.map((t) => [t.id, t.category?.slug ?? 'uncategorised']));
  const changed = updates.filter((u) => currentSlug.get(u.id) !== u.categorySlug);

  if (changed.length === 0) return 0;

  // Group by target category so this is one UPDATE per category rather than
  // one per transaction.
  const byCategory = new Map<string, string[]>();
  for (const update of changed) {
    const ids = byCategory.get(update.categorySlug);
    if (ids) ids.push(update.id);
    else byCategory.set(update.categorySlug, [update.id]);
  }

  await prisma.$transaction(
    [...byCategory].flatMap(([slug, ids]) => {
      const categoryId = categoryIdBySlug.get(slug);
      if (!categoryId) return [];
      return [
        prisma.transaction.updateMany({
          where: { id: { in: ids }, categoryLocked: false },
          data: { categoryId },
        }),
      ];
    }),
  );

  return changed.length;
}

export default registerRoutes;
