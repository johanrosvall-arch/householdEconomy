import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { contributeGoalSchema, createGoalSchema, toDateKey } from '@household/shared';
import { prisma } from '../prisma.js';
import { notFound } from '../lib/errors.js';
import { allocateMonthlySavings, projectGoal, type GoalInput } from '../services/goals.js';

const householdParams = z.object({ householdId: z.string() });
const goalParams = householdParams.extend({ goalId: z.string() });

const updateGoalSchema = createGoalSchema.partial().extend({
  archived: z.boolean().optional(),
});

const goalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/:householdId/goals', async (request) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId);

    const goals = await loadGoals(householdId);
    const totalMonthly = goals.reduce((sum, g) => sum + (g.monthlyContribution ?? 0), 0);

    return {
      goals,
      totalTarget: goals.reduce((sum, g) => sum + g.targetAmount, 0),
      totalSaved: goals.reduce((sum, g) => sum + g.savedAmount, 0),
      totalMonthlyCommitment: totalMonthly,
    };
  });

  fastify.post('/:householdId/goals', async (request, reply) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');
    const body = createGoalSchema.parse(request.body);

    const goal = await prisma.savingsGoal.create({
      data: {
        householdId,
        name: body.name,
        targetAmount: body.targetAmount,
        currency: body.currency,
        targetDate: body.targetDate ?? null,
        fundingAccountId: body.fundingAccountId ?? null,
        monthlyContribution: body.monthlyContribution ?? null,
        color: body.color ?? null,
        icon: body.icon ?? null,
      },
      select: { id: true },
    });

    reply.status(201);
    return { goal: (await loadGoals(householdId, goal.id))[0] };
  });

  fastify.patch('/:householdId/goals/:goalId', async (request) => {
    const { householdId, goalId } = goalParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');
    const body = updateGoalSchema.parse(request.body);

    const existing = await prisma.savingsGoal.findFirst({
      where: { id: goalId, householdId },
      select: { id: true },
    });
    if (!existing) throw notFound('Goal');

    await prisma.savingsGoal.update({
      where: { id: goalId },
      data: {
        ...(body.name != null ? { name: body.name } : {}),
        ...(body.targetAmount != null ? { targetAmount: body.targetAmount } : {}),
        ...(body.targetDate !== undefined ? { targetDate: body.targetDate ?? null } : {}),
        ...(body.monthlyContribution !== undefined
          ? { monthlyContribution: body.monthlyContribution ?? null }
          : {}),
        ...(body.fundingAccountId !== undefined
          ? { fundingAccountId: body.fundingAccountId ?? null }
          : {}),
        ...(body.color !== undefined ? { color: body.color ?? null } : {}),
        ...(body.icon !== undefined ? { icon: body.icon ?? null } : {}),
        ...(body.archived != null ? { archivedAt: body.archived ? new Date() : null } : {}),
      },
    });

    return { goal: (await loadGoals(householdId, goalId))[0] };
  });

  fastify.post('/:householdId/goals/:goalId/contributions', async (request, reply) => {
    const { householdId, goalId } = goalParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');
    const body = contributeGoalSchema.parse(request.body);

    const goal = await prisma.savingsGoal.findFirst({
      where: { id: goalId, householdId },
      select: { id: true, targetAmount: true, completedAt: true },
    });
    if (!goal) throw notFound('Goal');

    await prisma.goalContribution.create({
      data: {
        goalId,
        amount: body.amount,
        date: body.date ?? toDateKey(new Date()),
        note: body.note ?? null,
      },
    });

    // Mark completion the moment the target is reached, so the app can
    // celebrate it rather than waiting for the user to notice.
    const total = await prisma.goalContribution.aggregate({
      where: { goalId },
      _sum: { amount: true },
    });
    const saved = total._sum.amount ?? 0;

    if (saved >= goal.targetAmount && !goal.completedAt) {
      await prisma.savingsGoal.update({
        where: { id: goalId },
        data: { completedAt: new Date() },
      });
    } else if (saved < goal.targetAmount && goal.completedAt) {
      await prisma.savingsGoal.update({ where: { id: goalId }, data: { completedAt: null } });
    }

    reply.status(201);
    return { goal: (await loadGoals(householdId, goalId))[0] };
  });

  fastify.get('/:householdId/goals/:goalId/contributions', async (request) => {
    const { householdId, goalId } = goalParams.parse(request.params);
    await fastify.requireHousehold(request, householdId);

    const goal = await prisma.savingsGoal.findFirst({
      where: { id: goalId, householdId },
      select: { id: true },
    });
    if (!goal) throw notFound('Goal');

    const contributions = await prisma.goalContribution.findMany({
      where: { goalId },
      orderBy: { date: 'desc' },
      take: 200,
    });

    return { contributions };
  });

  fastify.delete('/:householdId/goals/:goalId', async (request) => {
    const { householdId, goalId } = goalParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');

    const existing = await prisma.savingsGoal.findFirst({
      where: { id: goalId, householdId },
      select: { id: true },
    });
    if (!existing) throw notFound('Goal');

    await prisma.savingsGoal.delete({ where: { id: goalId } });
    return { deleted: true };
  });

  /** Suggests how to split a given monthly amount across the open goals. */
  fastify.post('/:householdId/goals/allocate', async (request) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId);
    const { available } = z.object({ available: z.number().int().min(0) }).parse(request.body);

    const goals = await loadGoals(householdId);
    const allocation = allocateMonthlySavings(goals, available);

    return {
      available,
      allocation: [...allocation].map(([goalId, amount]) => ({ goalId, amount })),
      shortfall: Math.max(
        goals.reduce((sum, g) => sum + (g.requiredMonthly ?? 0), 0) - available,
        0,
      ),
    };
  });

  async function loadGoals(householdId: string, goalId?: string) {
    const rows = await prisma.savingsGoal.findMany({
      where: { householdId, archivedAt: null, ...(goalId ? { id: goalId } : {}) },
      include: {
        contributions: { select: { amount: true } },
        fundingAccount: { select: { balance: true } },
      },
      orderBy: [{ completedAt: 'asc' }, { targetDate: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => {
      const input: GoalInput = {
        id: row.id,
        name: row.name,
        targetAmount: row.targetAmount,
        currency: row.currency as GoalInput['currency'],
        targetDate: row.targetDate,
        monthlyContribution: row.monthlyContribution,
        fundingAccountId: row.fundingAccountId,
        color: row.color,
        icon: row.icon,
        completedAt: row.completedAt,
        contributedAmount: row.contributions.reduce((sum, c) => sum + c.amount, 0),
        fundingAccountBalance: row.fundingAccount?.balance ?? null,
      };
      return projectGoal(input);
    });
  }
};

export default goalRoutes;
