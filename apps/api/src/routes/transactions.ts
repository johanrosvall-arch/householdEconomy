import type { FastifyPluginAsync } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  createTransactionSchema,
  transactionQuerySchema,
  updateTransactionSchema,
  type TransactionDTO,
} from '@household/shared';
import { prisma } from '../prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import { insertTransactions, loadCategoryMap, recalculateBalance } from '../services/ledger.js';
import { normaliseDescription } from '../services/merchants.js';

const householdParams = z.object({ householdId: z.string() });
const transactionParams = householdParams.extend({ transactionId: z.string() });

/**
 * Query strings arrive as strings; coerce the numeric and boolean fields
 * before handing them to the shared schema.
 */
const rawQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    accountIds: z.union([z.string(), z.array(z.string())]).optional(),
    categorySlugs: z.union([z.string(), z.array(z.string())]).optional(),
    search: z.string().optional(),
    minAmount: z.coerce.number().int().optional(),
    maxAmount: z.coerce.number().int().optional(),
    includeTransfers: z.coerce.boolean().optional(),
    uncategorisedOnly: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().optional(),
    cursor: z.string().optional(),
  })
  .transform((q) => ({
    ...q,
    accountIds: toArray(q.accountIds),
    categorySlugs: toArray(q.categorySlugs),
  }));

function toArray(value: string | string[] | undefined): string[] | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value : value.split(',').filter(Boolean);
}

const bulkCategoriseSchema = z.object({
  transactionIds: z.array(z.string()).min(1).max(500),
  categorySlug: z.string(),
});

const transactionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/:householdId/transactions', async (request) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId);

    const query = transactionQuerySchema.parse(rawQuerySchema.parse(request.query ?? {}));

    const where: Prisma.TransactionWhereInput = { householdId };

    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    if (query.accountIds?.length) where.accountId = { in: query.accountIds };
    if (query.search) where.description = { contains: query.search, mode: 'insensitive' };
    if (query.minAmount != null || query.maxAmount != null) {
      where.amount = {
        ...(query.minAmount != null ? { gte: query.minAmount } : {}),
        ...(query.maxAmount != null ? { lte: query.maxAmount } : {}),
      };
    }
    if (query.uncategorisedOnly) {
      where.category = { slug: 'uncategorised' };
    } else if (query.categorySlugs?.length) {
      where.category = { slug: { in: query.categorySlugs } };
    }
    if (!query.includeTransfers) {
      where.category = { ...(where.category as object), kind: { not: 'transfer' } };
    }

    // Keyset pagination on (date, id): stable even as new rows arrive at the
    // top, which offset pagination is not.
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      where.OR = [
        { date: { lt: cursor.date } },
        { date: cursor.date, id: { lt: cursor.id } },
      ];
    }

    const rows = await prisma.transaction.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: {
        account: { select: { name: true } },
        category: { select: { slug: true } },
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      transactions: page.map(toDTO),
      nextCursor: hasMore && last ? encodeCursor(last.date, last.id) : null,
    };
  });

  fastify.post('/:householdId/transactions', async (request, reply) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');
    const body = createTransactionSchema.parse(request.body);

    const account = await prisma.account.findFirst({
      where: { id: body.accountId, householdId },
      select: { id: true },
    });
    if (!account) throw notFound('Account');

    const result = await insertTransactions(
      [{ date: body.date, amount: body.amount, description: body.description }],
      { householdId, accountId: body.accountId, source: 'manual', includeDuplicates: true },
    );

    const id = result.insertedIds[0];
    if (!id) throw badRequest('Could not record the transaction');

    // An explicit category on a manual entry is the user's choice, so lock it.
    if (body.categorySlug) {
      const categoryId = (await loadCategoryMap(householdId)).get(body.categorySlug);
      if (!categoryId) throw badRequest(`Unknown category "${body.categorySlug}"`);
      await prisma.transaction.update({
        where: { id },
        data: { categoryId, categoryLocked: true },
      });
    }
    if (body.notes || body.tags.length > 0) {
      await prisma.transaction.update({
        where: { id },
        data: { notes: body.notes ?? null, tags: body.tags },
      });
    }

    const created = await findOne(householdId, id);
    reply.status(201);
    return { transaction: created };
  });

  fastify.patch('/:householdId/transactions/:transactionId', async (request) => {
    const { householdId, transactionId } = transactionParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');
    const body = updateTransactionSchema.parse(request.body);

    const existing = await prisma.transaction.findFirst({
      where: { id: transactionId, householdId },
      include: { category: { select: { slug: true } } },
    });
    if (!existing) throw notFound('Transaction');

    const data: Prisma.TransactionUpdateInput = {};

    if (body.categorySlug) {
      const categoryId = (await loadCategoryMap(householdId)).get(body.categorySlug);
      if (!categoryId) throw badRequest(`Unknown category "${body.categorySlug}"`);
      data.category = { connect: { id: categoryId } };
      // A human decided this; automatic re-classification must not undo it.
      data.categoryLocked = true;
    }
    if (body.notes !== undefined) data.notes = body.notes ?? null;
    if (body.tags !== undefined) data.tags = body.tags;
    if (body.merchant !== undefined) data.merchant = body.merchant ?? null;

    await prisma.transaction.update({ where: { id: transactionId }, data });

    // "Apply to similar" turns a one-off correction into a standing rule, so
    // next month's statement classifies itself.
    let rulesCreated = 0;
    let alsoUpdated = 0;
    if (body.applyToSimilar && body.categorySlug) {
      const pattern = normaliseDescription(existing.merchant ?? existing.description)
        .split(' ')
        .slice(0, 2)
        .join(' ');

      if (pattern.length >= 3) {
        const categoryId = (await loadCategoryMap(householdId)).get(body.categorySlug)!;
        await prisma.categoryRule.create({
          data: {
            householdId,
            categoryId,
            field: 'description',
            matchType: 'contains',
            pattern,
            priority: 200,
          },
        });
        rulesCreated = 1;

        const { count } = await prisma.transaction.updateMany({
          where: {
            householdId,
            categoryLocked: false,
            id: { not: transactionId },
            description: { contains: pattern, mode: 'insensitive' },
          },
          data: { categoryId },
        });
        alsoUpdated = count;
      }
    }

    return {
      transaction: await findOne(householdId, transactionId),
      rulesCreated,
      alsoUpdated,
    };
  });

  fastify.post('/:householdId/transactions/bulk-categorise', async (request) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');
    const body = bulkCategoriseSchema.parse(request.body);

    const categoryId = (await loadCategoryMap(householdId)).get(body.categorySlug);
    if (!categoryId) throw badRequest(`Unknown category "${body.categorySlug}"`);

    const { count } = await prisma.transaction.updateMany({
      where: { householdId, id: { in: body.transactionIds } },
      data: { categoryId, categoryLocked: true },
    });

    return { updated: count };
  });

  fastify.delete('/:householdId/transactions/:transactionId', async (request) => {
    const { householdId, transactionId } = transactionParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');

    const existing = await prisma.transaction.findFirst({
      where: { id: transactionId, householdId },
      select: { id: true, accountId: true, source: true },
    });
    if (!existing) throw notFound('Transaction');

    // Deleting a synced row is pointless: the next sync re-imports it.
    if (existing.source === 'bank_sync') {
      throw badRequest(
        'This transaction came from your bank and would return on the next sync. Recategorise it instead.',
      );
    }

    await prisma.transaction.delete({ where: { id: transactionId } });
    await recalculateBalance(existing.accountId);

    return { deleted: true };
  });

  async function findOne(householdId: string, id: string): Promise<TransactionDTO> {
    const row = await prisma.transaction.findFirstOrThrow({
      where: { id, householdId },
      include: {
        account: { select: { name: true } },
        category: { select: { slug: true } },
      },
    });
    return toDTO(row);
  }
};

type TransactionRow = Prisma.TransactionGetPayload<{
  include: { account: { select: { name: true } }; category: { select: { slug: true } } };
}>;

function toDTO(row: TransactionRow): TransactionDTO {
  return {
    id: row.id,
    accountId: row.accountId,
    accountName: row.account.name,
    date: row.date,
    valueDate: row.valueDate,
    amount: row.amount,
    currency: row.currency as TransactionDTO['currency'],
    description: row.description,
    merchant: row.merchant,
    categorySlug: row.category?.slug ?? 'uncategorised',
    categoryLocked: row.categoryLocked,
    notes: row.notes,
    tags: row.tags,
    source: row.source,
    transferPairId: row.transferPairId,
    pending: row.pending,
    createdAt: row.createdAt.toISOString(),
  };
}

function encodeCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { date: string; id: string } {
  const [date, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!date || !id) throw badRequest('Malformed pagination cursor');
  return { date, id };
}

export default transactionRoutes;
