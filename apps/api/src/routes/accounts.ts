import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createAccountSchema, type AccountDTO } from '@household/shared';
import { prisma } from '../prisma.js';
import { notFound } from '../lib/errors.js';
import { insertTransactions, recalculateBalance } from '../services/ledger.js';

const paramsSchema = z.object({ householdId: z.string() });
const accountParams = paramsSchema.extend({ accountId: z.string() });

const updateAccountSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  includeInNetWorth: z.boolean().optional(),
  archived: z.boolean().optional(),
});

const accountRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/:householdId/accounts', async (request) => {
    const { householdId } = paramsSchema.parse(request.params);
    await fastify.requireHousehold(request, householdId);

    const accounts = await prisma.account.findMany({
      where: { householdId },
      orderBy: [{ archivedAt: 'asc' }, { createdAt: 'asc' }],
    });

    return { accounts: accounts.map(toDTO) };
  });

  fastify.post('/:householdId/accounts', async (request, reply) => {
    const { householdId } = paramsSchema.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');

    const body = createAccountSchema.parse(request.body);

    const account = await prisma.account.create({
      data: {
        householdId,
        name: body.name,
        type: body.type,
        currency: body.currency,
        institutionName: body.institutionName ?? null,
        includeInNetWorth: body.includeInNetWorth,
        balance: 0,
      },
    });

    // An opening balance is recorded as a real transaction rather than a bare
    // number, so the account's balance always equals the sum of its ledger.
    if (body.openingBalance !== 0) {
      await insertTransactions(
        [
          {
            date: new Date().toISOString().slice(0, 10),
            amount: body.openingBalance,
            description: 'Ingående saldo',
          },
        ],
        { householdId, accountId: account.id, source: 'manual' },
      );
    }

    const fresh = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    reply.status(201);
    return { account: toDTO(fresh) };
  });

  fastify.patch('/:householdId/accounts/:accountId', async (request) => {
    const { householdId, accountId } = accountParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');
    const body = updateAccountSchema.parse(request.body);

    const existing = await prisma.account.findFirst({
      where: { id: accountId, householdId },
      select: { id: true },
    });
    if (!existing) throw notFound('Account');

    const account = await prisma.account.update({
      where: { id: accountId },
      data: {
        ...(body.name != null ? { name: body.name } : {}),
        ...(body.includeInNetWorth != null ? { includeInNetWorth: body.includeInNetWorth } : {}),
        ...(body.archived != null ? { archivedAt: body.archived ? new Date() : null } : {}),
      },
    });

    return { account: toDTO(account) };
  });

  /**
   * Deleting an account removes its transactions too, which changes every
   * historical total. Archiving is the default in the UI; this is the escape
   * hatch for an account added by mistake.
   */
  fastify.delete('/:householdId/accounts/:accountId', async (request) => {
    const { householdId, accountId } = accountParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'owner');

    const existing = await prisma.account.findFirst({
      where: { id: accountId, householdId },
      select: { id: true },
    });
    if (!existing) throw notFound('Account');

    const { count } = await prisma.transaction.deleteMany({ where: { accountId } });
    await prisma.account.delete({ where: { id: accountId } });

    return { deleted: true, transactionsRemoved: count };
  });

  fastify.post('/:householdId/accounts/:accountId/recalculate', async (request) => {
    const { householdId, accountId } = accountParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');

    const existing = await prisma.account.findFirst({
      where: { id: accountId, householdId },
      select: { id: true },
    });
    if (!existing) throw notFound('Account');

    return { balance: await recalculateBalance(accountId) };
  });
};

type AccountRow = {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: number;
  mask: string | null;
  institutionName: string | null;
  connectionId: string | null;
  includeInNetWorth: boolean;
  lastSyncedAt: Date | null;
  archivedAt: Date | null;
};

function toDTO(account: AccountRow): AccountDTO {
  return {
    id: account.id,
    name: account.name,
    type: account.type as AccountDTO['type'],
    currency: account.currency as AccountDTO['currency'],
    balance: account.balance,
    mask: account.mask,
    institutionName: account.institutionName,
    connectionId: account.connectionId,
    includeInNetWorth: account.includeInNetWorth,
    lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
    archivedAt: account.archivedAt?.toISOString() ?? null,
  };
}

export default accountRoutes;
